# Twitter/X Bookmarks Local Visualization Workbench (Field Theory)

**English** | [简体中文](README.zh-CN.md)

A zero-dependency local web workbench that turns your bookmarked Twitter/X posts into a **searchable, classifiable, filterable, and chartable** personal knowledge base. It **depends on** [fieldtheory-cli](https://github.com/afar1/fieldtheory-cli) (which provides the `ft` command) to sync bookmark data and run export commands, and uses a local [jev scoring service](http://127.0.0.1:8000/score) for LLM-powered multi-label classification.

> All data stays on your machine and never passes through a third-party server. This project only handles presentation and classification orchestration — **bookmark fetching is done by fieldtheory-cli** (see [Dependencies](#dependencies)).

## Features

- **Bookmark browsing**: full-text search by keyword, author, language, and date range; filter by category / domain labels
- **Multi-label classification**: scores each bookmark via a local jev service (Qwen3.5-4B `/score`), classifying along both **category** and **domain** dimensions; results are incrementally persisted and resumable after interruption
- **Charts**: category / domain distribution, monthly bookmark trends, top authors — see the structure of your collection at a glance
- **Command tool queue**: run `ft` CLI commands (sync, export, build knowledge base, …) with one click; long tasks run in a serial queue with real-time incremental output and cancellation
- **Settings panel**: customize category / domain definitions (add / edit / delete + descriptions for the local model), plus concurrency and multi-label threshold

## Dependencies

This project does not fetch any data itself; bookmark data and command capabilities come from external components:

| Component | Source | Purpose | Required? |
| --- | --- | --- | --- |
| `ft` CLI | [fieldtheory-cli](https://github.com/afar1/fieldtheory-cli), install: `npm install -g fieldtheory` (MIT, requires Node.js 20+) | Syncs X bookmarks to `~/.fieldtheory/bookmarks/bookmarks.jsonl`; powers the command buttons on the Tools page (export Markdown, build knowledge base, stats, etc.) | Yes (run `ft sync` at least once, or the workbench has no data to show) |
| jev scoring service | Self-hosted local service `http://127.0.0.1:8000/score` | LLM multi-label classification scoring (Qwen3.5-4B) | No (browsing / search work fine without classification) |

Every command on the Tools page comes from a whitelist of fieldtheory-cli `ft` subcommands (`sync` / `md` / `wiki` / `lint` / `stats` / `index` / `status` / `categories` / `domains` / `path`, …). The workbench simply wraps them as visual buttons and executes them serially.

## Quick Start

### Requirements

- Node.js (>= 18, built-in `fetch`)
- [fieldtheory-cli](https://github.com/afar1/fieldtheory-cli) (`npm install -g fieldtheory`, requires Node.js 20+) — provides the `ft` commands to sync bookmarks / export Markdown, etc.; the data source for this workbench
- Local jev routing service `http://127.0.0.1:8000/score` (optional, only for LLM classification)

### Launch

```bash
git clone git@github.com:hyhkjiy/twitter-viewer.git
cd twitter-viewer
npm start
```

Open <http://127.0.0.1:8787> in your browser.

> Before first use, sync your bookmarks once via fieldtheory-cli:

```bash
ft sync   # requires a browser logged into X; bookmarks land in ~/.fieldtheory/bookmarks/bookmarks.jsonl
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Web server port |
| `BOOKMARKS_FILE` | `~/.fieldtheory/bookmarks/bookmarks.jsonl` | Bookmark data (one JSON object per line) |
| `FT_DIR` | `~/.fieldtheory` | Field Theory data directory |
| `FT_BIN` | `ft` | Path / name of the ft CLI executable |
| `JEV_URL` | `http://127.0.0.1:8000/score` | Local jev scoring service URL |
| `DATA_DIR` | `./data` | Directory where classification / domain results and config are persisted |
| `CATEGORY_FILE` | `data/categories-jev.json` | Category label results (bookmark id → label array) |
| `DOMAIN_FILE` | `data/domains-jev.json` | Domain label results (bookmark id → label array) |
| `CONFIG_FILE` | `data/viz-config.json` | Workbench config (category/domain definitions, concurrency, threshold) |

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/bookmarks` | Bookmark list (merged with category / domain labels and media info) |
| GET | `/api/config` | Read category / domain definitions and concurrency / threshold config |
| POST | `/api/config` | Save config (add/remove definitions, concurrency, multi-label threshold) |
| GET | `/api/status` | Classification progress and task status |
| POST | `/api/classify` | LLM multi-label classification as a background job (incrementally persisted) |
| POST | `/api/labels` | Manually set category / domain labels for one bookmark |
| GET | `/api/commands` | List available command tools (ft CLI whitelist) |
| POST | `/api/tasks` | Enqueue a command task (runs in a serial queue) |
| GET | `/api/tasks` | Task list summary |
| GET | `/api/tasks/<id>` | Task details + incremental output since `since` |
| POST | `/api/tasks/<id>/cancel` | Cancel a queued or running task |

## How It Works

1. **Data flow**: `ft sync` from fieldtheory-cli downloads X bookmarks into `bookmarks.jsonl`; the workbench reads it, merges category / domain labels (`data/*.json`) and media info by id, and serves it to the frontend.
2. **Multi-label classification**: the scoring input is built from "post text + link domains" (author names and x.com proved to be noise in practice and are excluded); the jev `/score` endpoint returns a probability per label — the highest-probability label is always kept, others are kept when probability ≥ `threshold` (default 0.15), up to `maxLabels` (default 3).
3. **Command queue**: frontend enqueues → server spawns the `ft` command serially → output is kept line-by-line incrementally (max 400 lines per task) → frontend polls incremental output every 2 seconds. The task list lives in memory and is cleared on restart.

## Project Structure

```
twitter-viewer/
├── server.js            # Zero-dependency Node server: static hosting + REST API + task queue
├── public/
│   └── index.html       # Single-page frontend (search / filter / charts / tools / settings)
├── data/                # Runtime data (gitignored): classification results and config
└── package.json
```

## Disclaimer

- This tool is for managing your own X bookmarks locally; please comply with X's terms of service and applicable local laws.
- [fieldtheory-cli](https://github.com/afar1/fieldtheory-cli) (MIT) and the jev scoring service are external components — install and configure them per their own docs; their dependencies and risks (e.g., browser session sync) are governed by those projects' documentation.
