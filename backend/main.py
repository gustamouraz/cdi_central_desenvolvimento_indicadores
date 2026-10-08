"""API e servidor da interface do CDI."""

import json
import uuid
from datetime import date
from decimal import Decimal
from urllib.parse import quote, quote_plus, urlparse, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import create_engine, text
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from cryptography.fernet import Fernet


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
IMAGE_DIR = DATA_DIR / "images"
DATASETS_FILE = DATA_DIR / "datasets.json"
DASHBOARDS_FILE = DATA_DIR / "dashboards.json"
CONNECTIONS_FILE = DATA_DIR / "connections.json"
CREDENTIALS_FILE = DATA_DIR / "credentials.enc"
CREDENTIAL_KEY_FILE = DATA_DIR / ".credentials.key"
FRONTEND_DIR = ROOT / "frontend"

for directory in (DATA_DIR, UPLOAD_DIR, IMAGE_DIR):
    directory.mkdir(exist_ok=True)

app = FastAPI(title="CDI API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def read_json(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def write_json(path: Path, value: list[dict[str, Any]]) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def credential_vault() -> Fernet:
    """Mantém a chave e os segredos apenas na instalação local do CDI."""
    if not CREDENTIAL_KEY_FILE.exists():
        CREDENTIAL_KEY_FILE.write_bytes(Fernet.generate_key())
    return Fernet(CREDENTIAL_KEY_FILE.read_bytes())


def read_credentials() -> dict[str, dict[str, str]]:
    if not CREDENTIALS_FILE.exists():
        return {}
    try:
        return json.loads(credential_vault().decrypt(CREDENTIALS_FILE.read_bytes()).decode("utf-8"))
    except Exception:
        return {}


def write_credentials(credentials: dict[str, dict[str, str]]) -> None:
    encrypted = credential_vault().encrypt(json.dumps(credentials).encode("utf-8"))
    CREDENTIALS_FILE.write_bytes(encrypted)


def credential_id(address: str, database: str) -> str:
    return f"{address.strip().lower()}|{database.strip().lower()}"


def save_connection_metadata(name: str, address: str, database: str, db_type: str) -> dict[str, Any]:
    connections = read_json(CONNECTIONS_FILE)
    key = credential_id(address, database)
    record = next((item for item in connections if item.get("key") == key), None)
    if record is None:
        record = {"id": str(uuid.uuid4()), "key": key}
        connections.append(record)
    record.update({"name": name.strip() or database.strip() or address.strip(), "address": address.strip(), "database": database.strip(), "db_type": db_type, "updated_at": datetime.now(timezone.utc).isoformat()})
    write_json(CONNECTIONS_FILE, connections)
    return {field: value for field, value in record.items() if field != "key"}


def database_url(address: str, database: str, username: str, password: str, db_type: str = "mssql") -> str:
    """Compõe uma URL SQLAlchemy a partir do endereço, database e credenciais."""
    address = address.strip()
    if address.startswith("sqlite:"):
        return address
    if db_type == "mssql":
        parsed = urlsplit(address) if "://" in address else None
        host = (parsed.netloc.rsplit("@", 1)[-1] if parsed else address).strip()
        path = database.strip() or (parsed.path.strip("/") if parsed else "")
        if not host or not path:
            raise HTTPException(400, "Informe endereço do SQL Server e database")
        try:
            import pyodbc
            installed = pyodbc.drivers()
            driver = next((item for item in ("ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server", "SQL Server") if item in installed), "ODBC Driver 18 for SQL Server")
        except Exception:
            driver = "ODBC Driver 18 for SQL Server"
        auth = quote(username, safe="")
        if password:
            auth += f":{quote(password, safe='')}"
        query = f"driver={quote_plus(driver)}&TrustServerCertificate=yes"
        return f"mssql+pyodbc://{auth}@{host}/{quote(path, safe='')}?{query}"
    parsed = urlsplit(address if "://" in address else f"postgresql://{address}")
    scheme = "postgresql+psycopg" if parsed.scheme == "postgresql" else parsed.scheme
    host = parsed.netloc.rsplit("@", 1)[-1]
    path = database.strip() or parsed.path.strip("/")
    if not host or not path:
        raise HTTPException(400, "Informe endereço do banco e database")
    auth = quote(username, safe="")
    if password:
        auth += f":{quote(password, safe='')}"
    return urlunsplit((scheme, f"{auth}@{host}", f"/{path}", parsed.query, ""))


def validate_database(url: str) -> None:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    finally:
        engine.dispose()


def dataset_or_404(dataset_id: str) -> dict[str, Any]:
    dataset = next((item for item in read_json(DATASETS_FILE) if item["id"] == dataset_id), None)
    if not dataset:
        raise HTTPException(404, "Base de dados não encontrada")
    return dataset


def read_dataset(dataset: dict[str, Any]) -> pd.DataFrame:
    path = UPLOAD_DIR / dataset["stored_file"]
    return pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)


def json_preview_value(value: Any) -> Any:
    """Converte tipos do banco (binário, decimal e data) para a prévia JSON."""
    if value is None:
        return None
    try:
        if not isinstance(value, (list, dict)) and bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, bytes):
        return f"0x{value.hex()}"
    if isinstance(value, (datetime, date, pd.Timestamp)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if hasattr(value, "item"):
        try:
            return json_preview_value(value.item())
        except Exception:
            pass
    return value


def read_source(content: bytes, suffix: str) -> pd.DataFrame:
    """Lê a fonte usando o mecanismo mais rápido disponível."""
    source = BytesIO(content)
    if suffix == ".csv":
        try:
            return pd.read_csv(source, engine="pyarrow")
        except Exception:
            source.seek(0)
            return pd.read_csv(source)
    if suffix == ".json":
        return pd.read_json(source)
    if suffix == ".xml":
        return pd.read_xml(source)
    try:
        return pd.read_excel(source, engine="calamine")
    except Exception:
        source.seek(0)
        return pd.read_excel(source)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/datasets")
def list_datasets() -> list[dict[str, Any]]:
    return read_json(DATASETS_FILE)


@app.post("/api/datasets")
async def upload_dataset(file: UploadFile = File(...)) -> dict[str, Any]:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".csv", ".xlsx", ".xls", ".json", ".xml"}:
        raise HTTPException(400, "Envie CSV, XLSX, XLS, JSON ou XML")

    content = await file.read()
    try:
        dataframe = read_source(content, suffix)
    except Exception as error:
        raise HTTPException(400, f"Não foi possível ler o arquivo: {error}") from error
    if dataframe.empty:
        raise HTTPException(400, "A base de dados está vazia")

    dataset_id = str(uuid.uuid4())
    stored_file = f"{dataset_id}.parquet"
    dataframe.to_parquet(UPLOAD_DIR / stored_file, index=False, compression="snappy")
    fields = [
        {
            "name": str(column),
            "dtype": str(dataframe[column].dtype),
            "kind": "number" if pd.api.types.is_numeric_dtype(dataframe[column]) else "category",
        }
        for column in dataframe.columns
    ]
    metadata = {
        "id": dataset_id,
        "name": Path(file.filename or "Base de dados").stem,
        "source_name": file.filename,
        "stored_file": stored_file,
        "rows": len(dataframe),
        "fields": fields,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    datasets = read_json(DATASETS_FILE)
    datasets.append(metadata)
    write_json(DATASETS_FILE, datasets)
    return metadata


@app.post("/api/images")
async def upload_image(file: UploadFile = File(...)) -> dict[str, str]:
    """Armazena uma imagem para uso em um visual do painel."""
    suffix = Path(file.filename or "").suffix.lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    if suffix not in allowed:
        raise HTTPException(400, "Envie uma imagem PNG, JPG, WEBP ou GIF")
    content = await file.read()
    if not content or len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "A imagem deve ter até 10 MB")
    filename = f"{uuid.uuid4()}{suffix}"
    (IMAGE_DIR / filename).write_bytes(content)
    return {"name": file.filename or filename, "url": f"/media/{filename}"}


def persist_dataset(dataframe: pd.DataFrame, name: str, source_name: str) -> dict[str, Any]:
    if dataframe.empty:
        raise HTTPException(400, "A fonte de dados não retornou registros")
    dataset_id = str(uuid.uuid4())
    stored_file = f"{dataset_id}.parquet"
    dataframe.to_parquet(UPLOAD_DIR / stored_file, index=False, compression="snappy")
    metadata = {
        "id": dataset_id,
        "name": name,
        "source_name": source_name,
        "stored_file": stored_file,
        "rows": len(dataframe),
        "fields": [{"name": str(column), "dtype": str(dataframe[column].dtype), "kind": "number" if pd.api.types.is_numeric_dtype(dataframe[column]) else "category"} for column in dataframe.columns],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    datasets = read_json(DATASETS_FILE)
    datasets.append(metadata)
    write_json(DATASETS_FILE, datasets)
    return metadata


@app.post("/api/connectors/api")
def import_api(payload: dict[str, Any]) -> dict[str, Any]:
    url = str(payload.get("url", "")).strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(400, "Informe uma URL HTTP ou HTTPS válida")
    try:
        request = Request(url, headers={"Accept": "application/json", **payload.get("headers", {})})
        with urlopen(request, timeout=30) as response:
            content = response.read()
        body = json.loads(content)
        dataframe = pd.json_normalize(body if isinstance(body, list) else body.get(payload.get("array_key", "data"), body))
    except Exception as error:
        raise HTTPException(400, f"Não foi possível consultar a API: {error}") from error
    return persist_dataset(dataframe, payload.get("name") or parsed.netloc, url)


@app.post("/api/connectors/database")
def import_database(payload: dict[str, Any]) -> dict[str, Any]:
    address = str(payload.get("address", "")).strip()
    database = str(payload.get("database", "")).strip()
    db_type = str(payload.get("db_type", "mssql")).strip()
    connection_url = str(payload.get("connection_url", "")).strip()
    query = str(payload.get("query", "")).strip()
    if not (connection_url or address) or not query.lower().startswith("select"):
        raise HTTPException(400, "Informe uma conexão e uma consulta SELECT")
    if not connection_url:
        if address.startswith("sqlite:"):
            connection_url = address
        else:
            credentials = read_credentials().get(credential_id(address, database))
            if not credentials:
                raise HTTPException(401, "Não há credenciais salvas para este endereço")
            connection_url = database_url(address, database, credentials["username"], credentials["password"], db_type)
    try:
        engine = create_engine(connection_url)
        with engine.connect() as connection:
            dataframe = pd.read_sql(text(query), connection)
        engine.dispose()
    except Exception as error:
        raise HTTPException(400, f"Não foi possível consultar o banco: {error}") from error
    try:
        return persist_dataset(dataframe, payload.get("name") or "Consulta de banco", address or "database")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(500, f"A consulta foi concluída, mas não foi possível preparar os dados: {error}") from error


@app.post("/api/connectors/database/credential-status")
def database_credential_status(payload: dict[str, Any]) -> dict[str, Any]:
    address = str(payload.get("address", "")).strip()
    database = str(payload.get("database", "")).strip()
    db_type = str(payload.get("db_type", "mssql")).strip()
    if address.startswith("sqlite:"):
        try:
            validate_database(address)
            return {"saved": True, "valid": True, "kind": "sqlite"}
        except Exception:
            return {"saved": False, "valid": False, "kind": "sqlite"}
    credentials = read_credentials().get(credential_id(address, database))
    if not credentials:
        return {"saved": False, "valid": False}
    try:
        validate_database(database_url(address, database, credentials["username"], credentials["password"], db_type))
        return {"saved": True, "valid": True}
    except Exception:
        return {"saved": True, "valid": False}


@app.post("/api/connectors/database/credentials")
def save_database_credentials(payload: dict[str, Any]) -> dict[str, Any]:
    address = str(payload.get("address", "")).strip()
    database = str(payload.get("database", "")).strip()
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    db_type = str(payload.get("db_type", "mssql")).strip()
    if not address or not username:
        raise HTTPException(400, "Informe endereço e usuário do banco")
    try:
        validate_database(database_url(address, database, username, password, db_type))
    except Exception as error:
        raise HTTPException(400, f"Não foi possível validar as credenciais: {error}") from error
    credentials = read_credentials()
    credentials[credential_id(address, database)] = {"username": username, "password": password}
    write_credentials(credentials)
    connection = save_connection_metadata(str(payload.get("name", "")), address, database, db_type)
    return {"saved": True, "valid": True, "connection": connection}


@app.get("/api/connections")
def list_connections() -> list[dict[str, Any]]:
    return [{field: value for field, value in item.items() if field != "key"} for item in read_json(CONNECTIONS_FILE)]


@app.post("/api/connections")
def save_connection(payload: dict[str, Any]) -> dict[str, Any]:
    address = str(payload.get("address", "")).strip()
    database = str(payload.get("database", "")).strip()
    db_type = str(payload.get("db_type", "mssql")).strip()
    if not address:
        raise HTTPException(400, "Informe o endereço do servidor")
    return save_connection_metadata(str(payload.get("name", "")), address, database, db_type)


@app.get("/api/datasets/{dataset_id}")
def get_dataset(dataset_id: str) -> dict[str, Any]:
    dataset = dataset_or_404(dataset_id)
    dataframe = read_dataset(dataset)
    preview = [{str(column): json_preview_value(value) for column, value in row.items()} for row in dataframe.head(100).to_dict(orient="records")]
    return {**dataset, "preview": preview}


@app.get("/api/datasets/{dataset_id}/profile/{field_name}")
def profile_dataset_field(dataset_id: str, field_name: str) -> dict[str, Any]:
    """Retorna estatísticas da coluna completa para inferir cardinalidade."""
    dataset = dataset_or_404(dataset_id)
    dataframe = read_dataset(dataset)
    if field_name not in dataframe.columns:
        raise HTTPException(404, "Campo não encontrado na base")
    values = dataframe[field_name].dropna()
    normalized = values.astype(str).str.strip()
    normalized = normalized[normalized != ""]
    count = int(len(normalized))
    return {
        "dataset_id": dataset_id,
        "field": field_name,
        "non_empty_count": count,
        "distinct_count": int(normalized.nunique()),
        "is_unique": bool(count and normalized.nunique() == count),
    }


@app.get("/api/dashboards")
def list_dashboards() -> list[dict[str, Any]]:
    return read_json(DASHBOARDS_FILE)


@app.post("/api/dashboards")
def save_dashboard(dashboard: dict[str, Any]) -> dict[str, Any]:
    dashboards = read_json(DASHBOARDS_FILE)
    dashboard_id = dashboard.get("id") or str(uuid.uuid4())
    record = {
        **dashboard,
        "id": dashboard_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    index = next((i for i, item in enumerate(dashboards) if item["id"] == dashboard_id), None)
    if index is None:
        dashboards.append(record)
    else:
        dashboards[index] = record
    write_json(DASHBOARDS_FILE, dashboards)
    return record


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
app.mount("/media", StaticFiles(directory=IMAGE_DIR), name="media")
