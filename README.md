> visualizador e editor de batches do Isatis.neo para máquinas sem licença.

Disponível em [link](https://gstvschlz.github.io/xjnl-viewer/).

![Abrindo o batch de exemplo](docs/demo.gif)

## Uso

No Edge ou no Chrome, abra uma pasta de batches e salve com Ctrl+S no próprio arquivo. Em outros navegadores, abra um `.xjnl`; o Salvar baixa uma cópia. O navegador lê e grava os arquivos na sua máquina, sem enviá-los a servidor algum.

No journal, você pode:

- editar valores, comentários e os cabeçalhos de `foreach`, `for` e `if`;
- mover, duplicar, apagar ou desativar blocos;
- copiar um bloco e colá-lo neste ou em outro journal (vai como XML, então também cola num editor de texto);
- desfazer e refazer (Ctrl+Z / Ctrl+Y), inclusive o Descartar;
- ver as linhas alteradas em relação ao arquivo no disco antes de salvar;
- buscar e substituir em todo o arquivo;
- validar a sintaxe dos blocos `python` no Python 3.11, a versão do Isatis.

O botão **Ver exemplo** abre [`exemplo/estimativa.xjnl`](exemplo/estimativa.xjnl), com dados fictícios.
