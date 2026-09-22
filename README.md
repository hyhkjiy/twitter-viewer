# Twitter/X 书签本地可视化工作台（Field Theory）

一个零依赖的本地 Web 工作台：把 Twitter/X 上收藏的书签变成**可搜索、可分类、可筛选、可图表化**的个人知识库。搭配 [Field Theory](https://github.com/) 生态的 `ft` CLI 使用（同步书签、导出 Markdown、构建知识库等），并通过本地 [jev 路由服务](https://github.com/) 提供 LLM 多标签分类。

> 数据全程留在本机，不经过任何第三方服务器。

## 功能一览

- **书签浏览**：按关键词、作者、语言、时间范围快速检索；支持分类 / 领域标签筛选
- **多标签分类**：调用本机 jev 服务（Qwen3.5-4B `/score`）逐条打分，可同时对标签**和**领域双维度分类，结果增量落盘、中断可续
- **可视化图表**：分类 / 领域分布、月度收藏趋势、Top 作者，一眼看清你的收藏结构
- **命令工具队列**：一键运行 `ft` CLI 命令（同步、导出、构建知识库…），长任务串行排队、输出实时增量查看、可取消
- **设置面板**：分类 / 领域定义可自定义（增删改 + 给模型的描述），并发数与多标签阈值可调

## 快速开始

### 环境要求

- Node.js（>= 18，内置 `fetch`）
- `ft` CLI 已在 `PATH` 中（可选，运行命令工具时使用）
- 本地 jev 路由服务 `http://127.0.0.1:8000/score`（可选，做 LLM 分类时使用）

### 启动

```bash
git clone git@github.com:hyhkjiy/twitter-viewer.git
cd twitter-viewer
npm start
```

浏览器打开 <http://127.0.0.1:8787> 即可使用。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | Web 服务端口 |
| `BOOKMARKS_FILE` | `~/.fieldtheory/bookmarks/bookmarks.jsonl` | 书签数据（每行一条 JSON） |
| `FT_DIR` | `~/.fieldtheory` | Field Theory 数据目录 |
| `FT_BIN` | `ft` | ft CLI 可执行文件 |
| `JEV_URL` | `http://127.0.0.1:8000/score` | 本地 jev 打分服务地址 |
| `DATA_DIR` | `./data` | 分类 / 领域结果与配置的落盘目录 |
| `CATEGORY_FILE` | `data/categories-jev.json` | 分类标签结果（书签 id → 标签数组） |
| `DOMAIN_FILE` | `data/domains-jev.json` | 领域标签结果（书签 id → 标签数组） |
| `CONFIG_FILE` | `data/viz-config.json` | 工作台配置（分类/领域定义、并发、阈值） |

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bookmarks` | 书签列表（合并分类 / 领域标签与媒体信息） |
| GET | `/api/config` | 读取分类 / 领域定义与并发 / 阈值配置 |
| POST | `/api/config` | 保存配置（增删改定义、并发数、多标签阈值） |
| GET | `/api/status` | 分类进度与任务状态 |
| POST | `/api/classify` | 对书签做 LLM 多标签分类（后台任务，增量落盘） |
| POST | `/api/labels` | 手动设置某条书签的分类 / 领域标签 |
| GET | `/api/commands` | 可用命令工具列表（ft CLI 白名单） |
| POST | `/api/tasks` | 入队一个命令任务（串行队列执行） |
| GET | `/api/tasks` | 任务列表摘要 |
| GET | `/api/tasks/<id>` | 任务详情 + `since` 之后的增量输出 |
| POST | `/api/tasks/<id>/cancel` | 取消排队中 / 运行中的任务 |

## 工作原理

1. **数据流**：`ft sync` 把 X 书签同步为 `bookmarks.jsonl`，工作台读取后按 id 合并分类 / 领域标签（`data/*.json`）与媒体信息，返回给前端。
2. **多标签分类**：把「正文 + 链接域名」（作者名与 x.com 经实测是噪声，已排除）拼成打分输入，请求 jev `/score` 返回各标签概率；概率最高者必选，其余概率 ≥ `threshold`（默认 0.15）的标签一并保留，最多 `maxLabels`（默认 3）个。
3. **命令队列**：前端入队 → 服务端串行 spawn `ft` 命令 → 输出按行增量保留（每任务最多 400 行）→ 前端每 2 秒轮询增量拉取。任务列表存于内存，重启即清空。

## 目录结构

```
twitter-viewer/
├── server.js            # 零依赖 Node 服务：静态托管 + REST API + 任务队列
├── public/
│   └── index.html       # 单页前端（搜索 / 筛选 / 图表 / 工具 / 设置）
├── data/                # 运行期数据（gitignore）：分类结果与配置
└── package.json
```

## 免责说明

- 本工具仅用于个人本地管理自己的 X 书签，请遵守 X 平台服务条款与所在地法律。
- `ft` CLI 与 jev 服务为外部组件，请按各自项目文档安装配置。
