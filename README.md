# FalaFoto

Aplicação local e sem APIs pagas que cria um avatar falante neural a partir de um retrato e uma faixa de áudio ou fala digitada.

## Rodar com Docker (recomendado)

```bash
docker compose up --build
```

Abra `http://localhost:3000`.

## Rodar sem Docker (mais simples)

Requisitos: Node.js 18+, FFmpeg e o ambiente `.venv-sadtalker` com os checkpoints em `vendor/SadTalker/checkpoints`.

```bash
npm start
```

O processamento acontece no servidor local. Uma GPU compatível acelera bastante a geração; nesta instalação o modelo está configurado para CPU.

## Modo neural de alta qualidade

- upload de JPG, PNG ou WEBP;
- upload de MP3, WAV, M4A, AAC, OGG, MP4 ou WEBM;
- sincronização labial, expressões, piscadas e pose geradas pelo SadTalker;
- prévia neural de até 5 segundos com sincronização labial realista antes do vídeo completo;
- pós-processamento rápido em 512 × 512, H.264 com áudio AAC;
- enquadramento original integral, sem corte da cabeça ou deformação corporal, sobre fundo desfocado quando necessário;
- pose frontal estabilizada para evitar viradas e deriva da cabeça em vídeos longos;
- processamento e armazenamento apenas na máquina onde o servidor roda;
- nenhum pacote npm e nenhuma API externa.

Em CPU, a etapa de renderização neural pode levar vários minutos mesmo para vídeos curtos. Para melhores resultados, use um retrato frontal, nítido, bem iluminado e com a boca visível.

## Texto para fala

A tela aceita áudio enviado ou texto digitado, sem API externa. Clara é sintetizada localmente pelo XTTS v2 a partir da referência autorizada em `public/clara.mp3`, sem alteração artificial de pitch. Luna usa MMS-TTS e as vozes masculinas usam Piper. O botão **Ouvir prévia** permite conferir a voz antes de gerar. XTTS e MMS-TTS possuem licenças de uso não comercial.

Também é possível gravar de 6 a 15 segundos pelo microfone e usar essa amostra como referência XTTS. Grave apenas sua própria voz ou uma voz para a qual você tenha autorização explícita.

## Movimento corporal local (Wan 2.2 Animate)

O estúdio aceita um vídeo-guia opcional para transferir movimentos de mãos, braços, corpo e rosto à imagem. Quando esse arquivo é enviado, a fila usa o Wan 2.2 Animate local; sem ele, usa o SadTalker. O repositório oficial está em `vendor/Wan2.2`, os pesos devem ficar em `models/Wan2.2-Animate-14B` (ou no caminho definido por `WAN_CHECKPOINT_DIR`) e o ambiente CUDA em `.venv-wan`.

O vídeo-guia deve conter apenas o gesto desejado. A aplicação mede a duração da fala, coloca o gesto automaticamente no centro e congela a pose inicial e final, mantendo os braços estáveis antes e depois do movimento.

Quando existe MP4 ou áudio selecionado, a geração sempre usa o som desse arquivo e ignora o texto. O texto só é sintetizado quando nenhum arquivo de mídia foi enviado.

## Configuração

- `PORT`: porta HTTP (padrão `3000`)
- `FFMPEG_PATH`: caminho opcional para o FFmpeg usado apenas pela API legada de MP4
- `FFMPEG_PRESET`: preset da conversão legada (padrão `veryfast`)

Os arquivos gerados ficam em `data/`. Em produção, configure uma rotina para apagar trabalhos antigos.
