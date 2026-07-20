# INSTALL — установка на чистой машине

Всё, что нужно, чтобы поднять стартер на ноутбуке, где пока ничего нет. Заложи
~25-40 минут за день ДО хакатона (на площадке Wi-Fi и npm медленнее, а скаффолд
приложения и первый OAuth для MCP лучше сделать дома).

## 0. Что нужно заранее

| Что нужно    | Проверка         | Где взять                                                |
| ------------ | ---------------- | -------------------------------------------------------- |
| **Node 22+** | `node --version` | https://nodejs.org или `nvm install 22`                  |
| **git**      | `git --version`  | Xcode CLT (`xcode-select --install`) / пакетный менеджер |
| **Терминал** | —                | Terminal.app / iTerm                                     |

`setup.sh` не запустится на Node ниже 22 (это нужно и Codex, и CodeGraph).

## 1. Аккаунты, которые нужны заранее (ДО дня хакатона)

Одна общая инфраструктура: **одна** база Supabase и **один** проект Vercel на всю
команду, а не по одному на каждого. Каждому участнику нужны только OpenAI + GitHub.

| Аккаунт                    | Кто      | Зачем                                                             |
| -------------------------- | -------- | ----------------------------------------------------------------- |
| **OpenAI** (ChatGPT / API) | все      | вход в Codex; $150 кредитов на площадке                           |
| **GitHub**                 | все      | пуш в общий репозиторий (владелец добавляет тебя в коллабораторы) |
| **Supabase**               | владелец | одна общая база; владелец раздаёт URL + anon-ключ                 |
| **Vercel**                 | владелец | один общий проект, привязанный к репозиторию (автодеплой веток)   |

Мы не кладём **никаких креденшелов**. Владелец один раз настраивает общие
Supabase + Vercel и раздаёт ключи Supabase; всем остальным нужны только
OpenAI + GitHub.

### Владелец — один раз на всю команду

1. Создай один проект Supabase и один проект Vercel.
2. В Vercel: Import Project → выбери общий GitHub-репозиторий (после этого каждый пуш ветки получает preview-URL).
3. Разошли команде URL + anon-ключ Supabase (для `app/.env.local`).
4. Запусти `./setup.sh --infra`, чтобы твой Codex мог управлять схемой через Supabase/Vercel MCP.
5. Добавь участников в коллабораторы (репозиторий → Settings → Collaborators).

## 2. Забери код

```bash
git clone https://github.com/walklikeaman/codex-hackathon-starter.git
cd codex-hackathon-starter
```

Это общий командный репозиторий — владелец добавляет участников в
**коллабораторы** (репозиторий → Settings → Collaborators), чтобы каждый мог
делать `/ship` (пуш). Кто не в коллабораторах — форкает и открывает PR.

## 3. Запусти setup

```bash
./setup.sh                 # участник: Codex + CodeGraph + скиллы (без аккаунтов БД/деплоя)
./setup.sh --infra         # владелец/бэкенд: ещё Vercel CLI + подключение Supabase и Vercel MCP
./setup.sh --playwright    # ещё подключить браузерный Playwright MCP (~100МБ chromium при первом запуске)
./setup.sh --check         # только проверка, ничего не ставит
```

`setup.sh` (идемпотентный — можно перезапускать):

1. проверяет Node 22+/npm;
2. ставит **Codex CLI** (`@openai/codex`) и **CodeGraph** (`@colbymchenry/codegraph`);
3. добавляет свежепоставленный глобальный bin в PATH, затем запускает `codegraph install`, чтобы подключить CodeGraph к Codex;
4. копирует `/ship` и loop-промпты в `~/.codex/prompts/`.

С **`--infra`** он ещё ставит Vercel CLI и подключает MCP-серверы **Supabase** и
**Vercel** — это нужно только тому одному, кто ведёт общий бэкенд/деплой. Все
остальные работают с общей базой через `app/.env.local`.

Если CLI поставились, но ещё не попали в PATH твоего шелла, скрипт об этом скажет
и попросит открыть новый терминал и перезапустить — ложного «успешно» не будет.

## 4. Собери работающее приложение

```bash
./scaffold.sh              # Next.js + TS + Tailwind в ./app  (или свой стек)
cd app
codegraph init            # собрать локальный индекс кода для Codex
npm run dev               # http://localhost:3000
```

`scaffold.sh` заодно создаёт `app/.env.local` из `.env.example` — заполни его
(он в gitignore). Если сделать скаффолд накануне, пакеты закешируются заранее.

## 5. Войди в аккаунты

```bash
codex           # первый запуск: вход под аккаунтом OpenAI/ChatGPT
vercel login    # только тому, кто ведёт деплой
```

Если запускал `--infra`, то **MCP Supabase и Vercel** при первом вызове агентом
каждый откроет свой OAuth в браузере — сделай это дома, чтобы не застало посреди
сборки, и выбери ТОТ ЖЕ общий проект. Остальным это не нужно — они ходят в общую
базу через `app/.env.local`.

## 6. Проверь, что всё работает

```bash
node --version                 # >= 22
codex --version
codegraph --version
vercel --version
codex mcp list                 # → codegraph  (supabase, vercel тоже, если запускал --infra)
ls ~/.codex/prompts/           # → ship.md, loop-demo.md, loop-lint.md, …
```

Потом открой репозиторий в Codex и убедись, что в строке SessionStart печатается
`[loops] .loops/guardrails.md: N guardrail(s) active` (Codex поддерживает
SessionStart-хуки из `.codex/hooks.json`). Если блок Project всё ещё пустой,
увидишь ещё и подсказку `[scope] ⚠ …` — заполни его до начала сборки.

## 7. Первый настоящий шаг

Заполни блок **«Проект»** в начале `AGENTS.md` (идея, категория, стек,
единственный демо-сценарий, что вне скоупа). Один этот блок держит команду из
3-6 человек нацеленной на одно и то же демо. Дальше — сборка.

## Ручное подключение MCP (если скрипт не смог)

```bash
codegraph install                                    # выбери Codex CLI по запросу
codex mcp add supabase --url https://mcp.supabase.com/mcp
codex mcp add vercel   --url https://mcp.vercel.com
codex mcp add playwright -- npx -y @playwright/mcp@latest   # по желанию
codex mcp list                                       # проверка
```

## Если что-то пошло не так

- **`codex: command not found` после установки** — глобальный npm-bin не в PATH
  этого шелла. Открой новый терминал; если не помогло, добавь
  `$(npm prefix -g)/bin` в PATH. (**Не** делай `npm i -g codex` — это посторонний
  пакет 2012 года. Нужен `@openai/codex`.)
- **CodeGraph пишет «not initialized»** в репозитории — запусти `codegraph init`,
  потом `codegraph index --force` в корне репозитория (делай это в папке `app/`).
- **Агент не может создать таблицу в Supabase** — у MCP должен быть завершён
  браузерный OAuth, и должен быть выбран проект. Перезапусти OAuth из свежей
  сессии агента.
- **`scaffold.sh` говорит, что папка уже есть** — передай другое имя: `./scaffold.sh web`.
