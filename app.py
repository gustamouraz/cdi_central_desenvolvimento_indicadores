import json
from datetime import datetime
from io import BytesIO
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st


st.set_page_config(page_title="CDI | Central de Desenvolvimento de Indicadores", page_icon="CDI", layout="wide")

ARQUIVO_INDICADORES = Path("data") / "indicadores.json"


def aplicar_estilo(tema_escuro: bool) -> None:
    st.markdown(
        """
        <style>
            .stApp { background: #f3f2f1; color: #323130; }
            #MainMenu, footer { visibility: hidden; }
            header[data-testid="stHeader"] { display: none; }
            .block-container { max-width: none; padding: 0 1.2rem 2rem; }
            .cdi-titlebar { height: 44px; background: #7c3aed; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; color: #ffffff; margin: 0 -1.2rem 0; font-size: 14px; font-weight: 700; }
            .cdi-titlebar span { color: #ede0ff; font-weight: 400; font-size: 12px; }
            .cdi-ribbon-tabs { background: #ffffff; border-bottom: 1px solid #e1dfdd; margin: 0 -1.2rem; padding: 7px 18px 0; display: flex; gap: 25px; font-size: 13px; color: #605e5c; }
            .cdi-ribbon-tabs b { color: #323130; padding-bottom: 7px; border-bottom: 3px solid #7c3aed; }
            .cdi-ribbon { background: #ffffff; border-bottom: 1px solid #e1dfdd; margin: 0 -1.2rem 16px; padding: 11px 18px; display: flex; gap: 28px; font-size: 12px; color: #605e5c; }
            .cdi-ribbon strong { color: #323130; display: block; margin-bottom: 3px; }
            .cdi-marca { color: #323130; font-size: 1.55rem; font-weight: 700; letter-spacing: -.04rem; margin: 12px 0 0; }
            .cdi-subtitulo { color: #605e5c; font-size: .86rem; margin: 0 0 14px; }
            [data-testid="stMetric"] { background: #191f2f; border: 1px solid #4a4455; border-radius: 4px; padding: 16px; }
            [data-testid="stMetric"] * { color: #dce2f7 !important; }
            [data-testid="stMetricLabel"] { text-transform: uppercase; font-size: 11px; letter-spacing: .06em; }
            .bloco-painel { background: #ffffff; border-left: 4px solid #f2c811; border-radius: 2px; padding: 14px 16px; color: #323130; }
            .workspace { background: #0c1322; color: #dce2f7; border: 1px solid #4a4455; border-radius: 4px; padding: 20px; margin-top: 4px; box-shadow: 0 8px 24px rgba(12, 19, 34, .20); }
            .workspace h3 { color: #dce2f7; }
            .workspace p { color: #ccc3d8; }
            div[data-testid="stButton"] button[kind="primary"] { background: #7c3aed; border-color: #7c3aed; color: #ffffff; font-weight: 700; }
            .stTabs [data-baseweb="tab-list"] { gap: 0; border-bottom: 1px solid #e1dfdd; }
            .stTabs [data-baseweb="tab"] { background: #ffffff; padding: 9px 18px; color: #475569; }
            .stTabs [aria-selected="true"] { color: #323130 !important; border-bottom-color: #7c3aed !important; }
            .stSelectbox label, .stRadio label { font-size: 12px !important; }
            [data-testid="stFileUploaderDropzone"] { background: #ffffff; border: 1px dashed #94a3b8; }
            [data-testid="stFileUploaderDropzone"] button { background: #7c3aed; border-color: #7c3aed; color: #ffffff; }
            [data-testid="stFileUploaderDropzone"] button * { color: #ffffff !important; }
        </style>
        """,
        unsafe_allow_html=True,
    )
    if tema_escuro:
        st.markdown(
            """
            <style>
                .stApp, [data-testid="stAppViewContainer"] { background: #070e1d !important; color: #dce2f7 !important; }
                .cdi-ribbon-tabs, .cdi-ribbon { background: #191f2f; border-color: #4a4455; color: #ccc3d8; }
                .cdi-ribbon-tabs b, .cdi-ribbon strong { color: #f5f1ff; }
                .cdi-marca { color: #f5f1ff; }
                .cdi-subtitulo { color: #ccc3d8; }
                .stTabs [data-baseweb="tab-list"] { border-color: #4a4455; }
                .stTabs [data-baseweb="tab"] { background: #191f2f; color: #ccc3d8; }
                .stTabs [aria-selected="true"] { background: #232a3a; color: #ffffff !important; }
                .stSelectbox label, .stRadio label, [data-testid="stWidgetLabel"] * { color: #dce2f7 !important; }
                div[data-baseweb="select"] > div { background: #191f2f !important; border-color: #4a4455 !important; }
                div[data-baseweb="select"] * { color: #f5f1ff !important; }
                [data-testid="stFileUploaderDropzone"] { background: #191f2f; border-color: #958da1; }
                [data-testid="stFileUploaderDropzone"] * { color: #dce2f7 !important; }
                [data-testid="stFileUploaderDropzone"] button { background: #7c3aed; border-color: #7c3aed; }
                [data-testid="stFileUploaderDropzone"] button * { color: #ffffff !important; }
                hr { border-color: #4a4455 !important; }
            </style>
            """,
            unsafe_allow_html=True,
        )
    else:
        st.markdown(
            """
            <style>
                .stApp { background: #eef2f7; color: #172033; }
                .cdi-titlebar { background: #ffffff; color: #5b21b6; border-bottom: 3px solid #7c3aed; }
                .cdi-titlebar span { color: #475569; }
                .workspace { background: #ffffff; color: #172033; border-color: #cbd5e1; box-shadow: 0 8px 24px rgba(15, 23, 42, .08); }
                .workspace h3 { color: #172033; }
                .workspace p { color: #475569; }
                [data-testid="stMetric"] { background: #ffffff; border-color: #cbd5e1; }
                [data-testid="stMetric"] * { color: #172033 !important; }
                [data-testid="stMetric"] [data-testid="stMetricLabel"] { color: #475569 !important; }
            </style>
            """,
            unsafe_allow_html=True,
        )


def carregar_dados(arquivo) -> pd.DataFrame:
    if arquivo.name.lower().endswith(".csv"):
        return pd.read_csv(arquivo)
    return pd.read_excel(arquivo)


def campos_numericos(df: pd.DataFrame) -> list[str]:
    return df.select_dtypes(include="number").columns.tolist()


def ler_indicadores() -> list[dict]:
    if not ARQUIVO_INDICADORES.exists():
        return []
    try:
        return json.loads(ARQUIVO_INDICADORES.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def gravar_indicadores(indicadores: list[dict]) -> None:
    ARQUIVO_INDICADORES.parent.mkdir(exist_ok=True)
    ARQUIVO_INDICADORES.write_text(
        json.dumps(indicadores, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def indice_opcao(opcoes: list[str], valor: str | None) -> int:
    return opcoes.index(valor) if valor in opcoes else 0


def criar_grafico(indicador: pd.DataFrame, dimensao: str, operacao: str, metrica: str, tipo: str):
    titulo = f"{operacao} de {metrica} por {dimensao}"
    if tipo == "Barras":
        figura = px.bar(indicador, x=dimensao, y="valor", title=titulo, color_discrete_sequence=["#7c3aed"])
    elif tipo == "Linha":
        figura = px.line(indicador, x=dimensao, y="valor", markers=True, title=titulo, color_discrete_sequence=["#d2bbff"])
    else:
        figura = px.pie(indicador, names=dimensao, values="valor", title=titulo, hole=.38, color_discrete_sequence=["#7c3aed", "#facc15", "#d2bbff", "#bdc7d9", "#ffb4ab"])
    tema_escuro = st.session_state.get("tema_escuro", True)
    fundo = "#0c1322" if tema_escuro else "#ffffff"
    texto = "#dce2f7" if tema_escuro else "#172033"
    grade = "#4a4455" if tema_escuro else "#e2e8f0"
    eixo = "#958da1" if tema_escuro else "#64748b"
    figura.update_layout(
        template="plotly_dark",
        paper_bgcolor=fundo,
        plot_bgcolor=fundo,
        font_color=texto,
        title_font_color=texto,
        margin=dict(l=20, r=20, t=60, b=20),
        coloraxis_showscale=False,
    )
    figura.update_xaxes(gridcolor=grade, linecolor=eixo)
    figura.update_yaxes(gridcolor=grade, linecolor=eixo)
    return figura


indicadores_salvos = ler_indicadores()

if "tema_escuro" not in st.session_state:
    st.session_state.tema_escuro = True

aplicar_estilo(st.session_state.tema_escuro)
nome_tema = "Escuro" if st.session_state.tema_escuro else "Claro"
st.markdown(f'<div class="cdi-titlebar">▦ &nbsp; CDI — Central de Desenvolvimento de Indicadores <span>Tema {nome_tema} &nbsp; ◯</span></div>', unsafe_allow_html=True)
st.markdown('<div class="cdi-ribbon-tabs"><b>Início</b><span>Inserir</span><span>Modelagem</span><span>Exibição</span><span>Ajuda</span></div>', unsafe_allow_html=True)
st.markdown('<div class="cdi-ribbon"><div><strong>Obter dados</strong>CSV, Excel e outras fontes</div><div><strong>Transformar dados</strong>Preparar e estruturar a base</div><div><strong>Novo visual</strong>Criar gráficos e indicadores</div><div><strong>Publicar</strong>Compartilhar o painel</div></div>', unsafe_allow_html=True)
st.markdown('<p class="cdi-marca">Relatório CDI</p>', unsafe_allow_html=True)
st.markdown('<p class="cdi-subtitulo">Desenvolvimento visual de indicadores gerenciais</p>', unsafe_allow_html=True)

controle_tema, controle_dados, controle_paineis = st.columns([1, 2, 2])
with controle_tema:
    st.toggle("Tema escuro", key="tema_escuro", help="Alterne entre os temas claro e escuro.")
with controle_dados:
    arquivo = st.file_uploader("Importar dados", type=["csv", "xlsx", "xls"])
with controle_paineis:
    nomes_salvos = [item["nome"] for item in indicadores_salvos]
    painel_escolhido = st.selectbox("Abrir indicador salvo", ["Novo indicador", *nomes_salvos])

st.divider()

configuracao = next((item for item in indicadores_salvos if item["nome"] == painel_escolhido), {})

if not arquivo:
    st.markdown(
        """<div class="bloco-painel"><strong>Comece pela sua base.</strong><br>
        Importe um arquivo CSV ou Excel para montar ou reabrir um indicador.</div>""",
        unsafe_allow_html=True,
    )
    st.stop()

try:
    dados = carregar_dados(arquivo)
except Exception as erro:
    st.error(f"Não foi possível ler o arquivo: {erro}")
    st.stop()

if dados.empty:
    st.warning("O arquivo não possui dados para analisar.")
    st.stop()

numericos = campos_numericos(dados)
dimensoes = dados.columns.tolist()
st.success(f"Base carregada: {len(dados):,} registros e {len(dados.columns)} campos.")

aba_painel, aba_dados, aba_salvos = st.tabs(["Construtor", "Dados", "Indicadores salvos"])

with aba_painel:
    st.markdown('<div class="workspace">', unsafe_allow_html=True)
    st.subheader("Visão geral de desempenho")
    st.caption("Configure os campos do visual e acompanhe a análise no canvas.")
    coluna_a, coluna_b, coluna_c = st.columns(3)
    with coluna_a:
        dimensao = st.selectbox("Agrupar por", dimensoes, index=indice_opcao(dimensoes, configuracao.get("dimensao")))
    with coluna_b:
        if numericos:
            metrica = st.selectbox("Métrica", numericos, index=indice_opcao(numericos, configuracao.get("metrica")))
        else:
            st.text_input("Métrica", value="Nenhuma coluna numérica disponível", disabled=True)
            metrica = None
    with coluna_c:
        tipos = ["Barras", "Linha", "Pizza"]
        tipo = st.selectbox("Visualização", tipos, index=indice_opcao(tipos, configuracao.get("tipo")))

    if not numericos:
        st.warning("Inclua ao menos uma coluna numérica para criar indicadores.")
    else:
        operacoes = ["Soma", "Média", "Contagem"]
        operacao = st.radio("Cálculo", operacoes, horizontal=True, index=indice_opcao(operacoes, configuracao.get("operacao")))
        agregacoes = {"Soma": "sum", "Média": "mean", "Contagem": "count"}
        indicador = (dados.groupby(dimensao, dropna=False)[metrica].agg(agregacoes[operacao]).reset_index(name="valor").sort_values("valor", ascending=False))
        total = indicador["valor"].sum() if operacao != "Média" else indicador["valor"].mean()

        card_1, card_2, card_3 = st.columns(3)
        card_1.metric(f"{operacao} de {metrica}", f"{total:,.2f}")
        card_2.metric("Categorias", indicador[dimensao].nunique())
        card_3.metric("Registros analisados", f"{len(dados):,}")
        st.plotly_chart(criar_grafico(indicador, dimensao, operacao, metrica, tipo), width="stretch")

        salvar_coluna, exportar_coluna = st.columns([1, 1])
        with salvar_coluna:
            with st.form("salvar_indicador", clear_on_submit=True):
                nome = st.text_input("Nome do indicador", placeholder="Ex.: Vendas por região")
                salvar = st.form_submit_button("Salvar indicador", type="primary")
            if salvar:
                if not nome.strip():
                    st.error("Informe um nome para salvar o indicador.")
                elif nome.strip() in nomes_salvos:
                    st.error("Já existe um indicador com esse nome.")
                else:
                    indicadores_salvos.append({"nome": nome.strip(), "dimensao": dimensao, "metrica": metrica, "operacao": operacao, "tipo": tipo, "criado_em": datetime.now().strftime("%d/%m/%Y %H:%M")})
                    gravar_indicadores(indicadores_salvos)
                    st.rerun()
        with exportar_coluna:
            st.download_button("Baixar dados do indicador", indicador.to_csv(index=False).encode("utf-8-sig"), "indicador_cdi.csv", "text/csv")
    st.markdown('</div>', unsafe_allow_html=True)

with aba_dados:
    st.dataframe(dados, width="stretch")
    buffer = BytesIO()
    dados.to_excel(buffer, index=False)
    st.download_button("Baixar base", buffer.getvalue(), "base_cdi.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

with aba_salvos:
    st.subheader("Biblioteca de indicadores")
    if not indicadores_salvos:
        st.info("Nenhum indicador salvo ainda.")
    else:
        st.dataframe(pd.DataFrame(indicadores_salvos), width="stretch", hide_index=True)
        excluir = st.selectbox("Excluir indicador", nomes_salvos, key="excluir_indicador")
        if st.button("Excluir selecionado"):
            gravar_indicadores([item for item in indicadores_salvos if item["nome"] != excluir])
            st.rerun()
