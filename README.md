# CDI — Central de Desenvolvimento de Indicadores

Protótipo inicial de uma ferramenta para criação visual de indicadores gerenciais com Python.

## Primeiro uso

No PowerShell, dentro desta pasta:

```powershell
python -m pip install -r requirements.txt
python -m streamlit run app.py
```

O painel será aberto no navegador. Importe um arquivo `.csv`, `.xlsx` ou `.xls`, escolha a dimensão, a métrica e a visualização desejada.

## Editor visual CDI (nova arquitetura)

O editor visual com arrastar-e-soltar usa FastAPI e está em `backend/` e `frontend/`.

```powershell
python -m uvicorn backend.main:app --reload
```

Abra `http://127.0.0.1:8000`. A barra esquerda alterna Relatório, Dados e Relacionamentos; à direita ficam Filtros, Visualizações e Dados. Importe uma base, arraste visuais para o canvas e salve o painel.

As bases importadas são convertidas internamente para Parquet, acelerando as leituras seguintes. Para arquivos muito grandes, CSV tende a carregar mais rápido que Excel.

## Escopo desta primeira versão

- Importação de CSV e Excel;
- Construtor visual de um indicador agregado;
- Gráficos de barras, linha e pizza;
- Exportação do resultado para CSV;
- Visualização e exportação da base carregada.

## Evoluções incluídas

- Identidade visual própria do CDI;
- Salvamento local das configurações dos indicadores em `data/indicadores.json`;
- Reabertura de indicadores salvos ao importar a base correspondente;
- Biblioteca para consultar e excluir configurações salvas.
- Interface redesenhada com a referência visual do CDI: barra de comandos, área de relatório escura e painéis de dados.
