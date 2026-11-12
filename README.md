# 🚚 Entrega Maluca

Jogo cooperativo 3D no navegador para até **4 amigos** (PC ou celular). Vocês dirigem veículos desajeitados
por uma cidade lowpoly e entregam encomendas dentro do tempo, enquanto chuva, trânsito, obras, buracos e vento
atrapalham. Partidas de 6 minutos.

- **Cliente:** Vite + TypeScript + Three.js + Rapier (física) — pasta `client/`
- **Servidor:** Node.js + WebSocket (`ws`), salas por código de 4 letras — pasta `server/`
- **Compartilhado:** tipos do protocolo e o layout da cidade — pasta `shared/`
- Sem login: apelido + cor + veículo. Tudo em português do Brasil.

## Como rodar (desenvolvimento)

Requisitos: **Node.js 20+**.

```bash
npm run instalar     # instala as dependências do servidor e do cliente
npm run dev          # sobe servidor (porta 2567) e cliente (porta 5173)
```

Abra `http://localhost:5173`, crie uma sala e compartilhe o link de convite.

**Jogar com amigos na mesma rede Wi-Fi / testar no celular:** descubra o IP do seu PC (ex.: `192.168.0.10`) e
abra `http://192.168.0.10:5173` nos outros aparelhos. O cliente procura o servidor no mesmo endereço, porta `2567`.
Se o Windows perguntar, libere o Node no firewall.

Scripts úteis: `npm run dev:servidor`, `npm run dev:cliente`, `npm run build` (build do cliente).

## Controles

| Ação | PC | Celular |
|---|---|---|
| Dirigir | WASD / setas | joystick à esquerda |
| Pular / freio de mão | Espaço (segure = derrapa) | botão laranja |
| Pegar / passar / arremessar pacote | E | botão 📦 |
| Buzina | C | botão 📣 |
| Descer/subir da van (modo "Mesmo carro") | F | botão 🚐 |
| Aceitar pedido (gerente, modo "Mesmo carro") | 1, 2, 3 ou clique | toque no botão "Aceitar" |
| Câmera | arrastar o mouse | arrastar o dedo |
| Voltar à largada | R | — |

**Pegar (E):** perto do pilar de luz 📦 pega a encomenda. Com a mão cheia: se há um amigo por perto, **passa**
para ele; senão, **arremessa** (dá para acertar a zona de entrega de longe!).

## Modos de jogo (o anfitrião escolhe no lobby)

- **🤝 Equipe:** todos veem os mesmos pedidos e cooperam; cada um dirige o seu veículo.
- **🏁 Individual:** cada jogador tem os seus próprios pedidos (mesma cidade, mesmo mapa). Ranking ao vivo e vence quem ganhar mais.
- **🚐 Mesmo carro:** uma única van, e cada jogador cumpre um papel:
  - **🚗 Motorista:** só dirige. Não tem minimapa nem setas: depende do navegador.
  - **🗺️ Navegador:** vê o minimapa grande, com ruas nomeadas (letras e números) para "cantar" onde virar.
  - **🏃 Entregador:** desce da van (F) com ela parada, pega o pacote a pé (E), volta para a van e, no destino, desce e entrega a pé.
  - **📋 Gerente:** vê as ofertas de pedido e decide quais aceitar (até 3 em andamento); vê os pontos na rua, mas não tem minimapa.
  Com menos de 4 jogadores os papéis se combinam (2: dirige+navega / desce+aceita; 3: dirige / navega+aceita / desce; 1: tudo).

## Regras do jogo

- Pedidos aparecem com prazo. Cada entrega paga pelo tipo de pacote + distância; **pacote danificado paga menos** e
  **sobrar tempo gera bônus**.
- Tipos de pacote: 🎈 leve (cai em batidas), 🧱 pesado (deixa o veículo lento), 🥚 frágil (quebra com impacto forte),
  💧 líquido (derrama em curvas e freadas bruscas).
- Eventos de caos (um por vez, sorteados pelo servidor): chuva (derrapa mais), trânsito intenso, obras, buraco gigante, vento.
- Dinheiro da equipe é acumulado entre as partidas e gasto na **loja** do lobby: velocidade, estabilidade, capacidade
  (até 4 pacotes), chapéus e buzinas.
- Fim da partida: dinheiro total, "entregador do dia", pacotes perdidos e uma estatística engraçada (quem mais capotou).

## Arquitetura (resumo)

- **Autoridade do servidor:** tempo, pedidos, pacotes, dinheiro, eventos e loja. O cliente só prevê o movimento do **próprio
  veículo** (física Rapier local) e envia posição ~20x/s; os outros jogadores aparecem interpolados (atraso de ~130 ms).
  Impactos e balanço da carga são reportados ao servidor, que decide o estrago nos pacotes.
- **Trânsito e eventos** dependem só do relógio do servidor: todos veem os mesmos carros sem tráfego de rede extra.
- Cones e caixotes são props locais (não sincronizados entre jogadores, de propósito, para economizar rede).
- Cidade determinística (`shared/cidade.ts`): igual para todos, com colisão de pacotes arremessados no servidor.
- Qualidade gráfica: Alta/Média/Baixa (botão ⚙️ no PC). No celular começa em Baixa; se o FPS cair, o jogo reduz sozinho.

```
client/src/
  main.ts            ponto de entrada e laço do jogo
  veiculo/           modelos, física do veículo, veículos remotos
  mundo/             cena, cidade, trânsito, câmera, eventos de caos
  jogo/              pacotes, marcadores e seta guia
  interface/         HUD, menu/lobby/loja/tutorial, controles, minimapa, qualidade
  audio/             Web Audio: motor, buzinas, efeitos e música
  efeitos/           partículas
  rede/              cliente WebSocket
  fisica/            Rapier (passo fixo de 60 Hz)
server/src/          index.ts (salas e WebSocket), sala.ts (lobby/loja), jogo.ts (partida)
shared/              protocolo.ts, constantes.ts, cidade.ts
```

## Publicar (deploy)

São duas partes: o **cliente** (estático) e o **servidor** (Node, precisa aceitar WebSocket). Publique o servidor
**primeiro**, para saber a URL.

### 1) Servidor no Render (gratuito)

1. Suba este projeto para um repositório no GitHub (a raiz do repositório é a pasta `entrega-maluca`).
2. No Render: **New → Blueprint** e aponte para o repositório. O arquivo `render.yaml` já configura tudo.
   (Ou **New → Web Service** manualmente: *Build Command* `cd server && npm install`,
   *Start Command* `cd server && npm start`, *Health Check Path* `/`.)
3. Anote a URL, por exemplo `https://entrega-maluca-servidor.onrender.com`. A versão WebSocket é
   `wss://entrega-maluca-servidor.onrender.com`.

> O plano gratuito "dorme" após alguns minutos sem uso; o primeiro acesso pode levar ~30 s para acordar.

**Railway:** *New Project → Deploy from GitHub repo*; em *Settings* defina *Build Command* `cd server && npm install`
e *Start Command* `cd server && npm start`. A porta é lida da variável `PORT` automaticamente. Em *Networking*,
gere um domínio público e use `wss://<dominio>`.

### 2) Cliente no Netlify

1. No Netlify: **Add new site → Import an existing project** e escolha o repositório.
   O `netlify.toml` já define *base* `client`, comando `npm install && npm run build` e pasta `dist`.
2. Em **Site settings → Environment variables** crie:

   ```
   VITE_SERVIDOR = wss://entrega-maluca-servidor.onrender.com
   ```
3. Faça o deploy. Compartilhe o endereço do Netlify com os amigos: o link de convite de cada sala
   (`https://seu-site.netlify.app/?sala=ABCD`) já funciona.

Deploy manual sem Git: `VITE_SERVIDOR=wss://... npm run build` (na pasta `client`) e arraste a pasta `client/dist`
para o Netlify Drop.

### Variáveis de ambiente

| Onde | Nome | Para quê |
|---|---|---|
| cliente (build) | `VITE_SERVIDOR` | URL `wss://` do servidor. Sem ela, usa `ws://<mesmo-host>:2567` (desenvolvimento). |
| servidor | `PORT` | porta HTTP/WebSocket (Render/Railway definem sozinhos; padrão `2567`). |
| servidor | `DINHEIRO_INICIAL` | só para testes: começa as salas com esse dinheiro (ex.: `2000`). |

## Problemas comuns

- **"Não consegui conectar ao servidor"**: o servidor não está rodando, o firewall bloqueia a porta 2567 ou
  `VITE_SERVIDOR` está errada. Em site `https://` o servidor precisa ser `wss://`.
- **Sem som**: navegadores só liberam áudio depois de um clique/toque. Use o botão 🔊 para ligar/desligar.
- **Jogo pesado no celular**: o jogo já reduz os gráficos sozinho; no PC use o botão ⚙️ para escolher "Baixa".
- **Aba em segundo plano**: o navegador pausa a animação; ao voltar o jogo retoma.

## Limites conhecidos

- Colisão entre veículos de jogadores diferentes é local a cada cliente (corpos cinemáticos): dá para empurrar e ser
  empurrado, mas cada tela vê a sua versão do empurrão.
- Os pacotes arremessados colidem com os prédios no servidor, mas não com carros e props.
- Salas ficam só em memória: reiniciar o servidor encerra as partidas em andamento.
