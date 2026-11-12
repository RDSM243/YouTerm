# Testar uma versão de debug pelo Antigravity

Abra a pasta do projeto no Antigravity e use o terminal integrado na raiz do YouTerm.

## Compilar e abrir

Execute:

```bash
cd /home/r0dz/Documents/GeminiProjects/YouTerm
npm run app:debug
```

O comando recompila a interface e executa o aplicativo nativo com a compilação **debug** do Rust. Na primeira vez, a compilação pode demorar alguns minutos. Não gera instalador nem AppImage.

O script seleciona automaticamente o Cargo instalado pelo Rustup em `~/.cargo/bin` (ou em `CARGO_HOME`) e o Node local em `.runtime`, quando disponíveis. Isso evita que o terminal do Antigravity use o Cargo antigo do sistema e apresente o erro `lock file version 4 requires -Znext-lockfile-bump`.

O executável fica em `src-tauri/target/debug/youterm`. O teste usa a porta local `3185` e grava sua configuração em `.cache/debug-profile/config`. A porta separada mantém as preferências da interface separadas das da versão normal, que usa a porta `3000`. A biblioteca do perfil de teste começa vazia; não é necessário entrar na conta para testar os visuais. Deixe a porta `3185` livre para manter o mesmo perfil entre testes.

Se estiver usando outra máquina, instale as dependências do projeto com `npm install` e tenha o Rust e as dependências nativas do Tauri disponíveis. Em Linux, isso inclui as bibliotecas de desenvolvimento do WebKitGTK 4.1 e GTK 3. Se o Node local e o Cargo do Rustup não existirem, o script usa as ferramentas disponíveis no terminal.

## Experimentar a personalização

1. Abra **Settings → Appearance**.
2. Experimente **Terminal**, **Rounded** e **Cover Focus**. O último fica mais evidente depois de selecionar uma música.
3. Ajuste os cantos dos painéis, botões e capas, o espaço entre painéis, as bordas e as sombras. A prévia acompanha as mudanças.
4. Experimente a lateral à direita ou oculta, o player no topo e a barra de progresso contínua. Mesmo sem o cabeçalho, o seletor de visualização continua disponível junto à busca.
5. Use **Undo / redo look** para alternar com o ajuste anterior, ou **Reset shapes & layout** para restaurar a geometria original.
6. Em **Themes → Save current look**, dê um nome e salve o visual para reaplicar depois. **Export skin** gera um JSON completo. **Import JSON** restaura os visuais novos e continua aceitando os temas antigos de cores. Os arquivos de imagem de fundo não são incluídos; importe a imagem separadamente no dispositivo de destino.

As alterações ficam salvas no perfil de teste. Para encerrar, feche a janela do player; o comando retorna ao terminal. Também pode interrompê-lo com **Ctrl+C** no terminal. Para testar alterações posteriores no código, execute `npm run app:debug` de novo.

## Montar um layout por arrastar

1. Clique em **Edit layout**, ao lado da busca, ou em **Settings → Appearance → Edit layout**. O editor parte da visualização atual.
2. Arraste a alça com o nome de um painel sobre outro. A área destacada indica o encaixe: esquerda, direita, acima ou abaixo. Soltar no centro troca os dois painéis de lugar.
3. Em **Add panel**, adicione biblioteca, lista de músicas, capa, letras, visualizador ou controles de reprodução. O **×** no cabeçalho oculta um painel; ele pode ser adicionado novamente pela barra do editor.
4. Arraste os divisores para ajustar as proporções. Também é possível focar um divisor e usar as setas do teclado.
5. Use **Undo / Redo** para revisar alterações e **Reset layout** para voltar à composição padrão de painéis. **Save layout** guarda o resultado; **Cancel layout** ou **Esc** descarta a edição. Durante um arraste, o primeiro Esc cancela apenas o movimento.

Também é possível organizar os painéis pelo teclado: foque a alça de um painel, pressione **Enter** e depois escolha um dos botões de destino apresentados nos outros painéis. **Ctrl+Z** desfaz e **Ctrl+Shift+Z** refaz durante a edição.

O layout salvo reaparece em **Custom layout**, no seletor de visualização, e é restaurado ao abrir o player. As posições e proporções acompanham **Save current look**, **Export skin** e **Import JSON**. Fora do editor, redimensionar um divisor salva o novo tamanho automaticamente. A reprodução continua durante a edição.

## Somente compilar

```bash
npm run debug:build
```

Depois, ainda na raiz do projeto, abra o binário já compilado:

```bash
./src-tauri/target/debug/youterm --port 3185 --data-dir .cache/debug-profile
```

## Verificações da personalização

```bash
npm run typecheck
npm run test:skins
```
