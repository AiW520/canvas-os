# Canvas OS

中文 AI 创作工作台，将无限画布、图片与视频素材管理、动态 HTML 演示文稿和点选编辑整合在一个浏览器界面中。

当前版本面向受邀团队内测。团队成员共享服务端素材，画布和 PPT 草稿保存在各自浏览器中；尚不支持跨设备草稿同步、多人同时编辑或多租户工作区隔离。

## 主要功能

- 无限画布：拖动、缩放、节点连线、媒体预览与视图定位。
- HTML PPT：场景编辑、动态转场、图表、演示播放、冻结版本与导出检查。
- 点选编辑：选择页面元素并描述修改，支持 AI 编辑连接。
- 媒体素材：上传图片和视频、加入画布或 PPT，图片可随 HTML 内嵌，视频支持 ZIP 打包导出。
- 账号与管理台：登录注册、成员权限、账号停用、单次邀请、配置检查和项目备份。
- 图片生成：通过 Tuzi coding 通道调用固定的 `gpt-image-2`，保存生成结果并防止相同请求重复提交。

## 本地运行

需要 Python 3.11 或更高版本。应用后端使用 Python 标准库，前端无需构建。

```powershell
git clone https://github.com/AiW520/canvas-os.git
cd canvas-os
python server.py --port 4195
```

打开 <http://127.0.0.1:4195/>；PPT 编辑入口为 <http://127.0.0.1:4195/?view=present>。

空账号数据库中第一个注册的用户会成为管理员。团队使用前先在本机初始化管理员，并关闭公开注册。

默认账号数据位于 `.canvas-auth/`，素材位于 `.canvas-assets/`。这两个目录不会提交到 Git；浏览器草稿需通过应用导出备份。不要用只提供静态文件的服务器替代 `server.py`，登录和素材接口依赖后端。

## AI 与部署配置

图片生成依赖额外的 Tuzi 图片生成组件，本仓库未包含该组件。设置 `CANVAS_IMAGE_SCRIPT` 指向兼容的 `generate_image.py`，并向服务进程注入 `TUZI_CODING_API_KEY`；未配置时仍可使用上传、画布和 PPT 编辑。接口使用 `https://api.tu-zi.com/coding`，模型固定为 `gpt-image-2`。

| 环境变量 | 用途 |
| --- | --- |
| `CANVAS_AUTH_DB` | 持久账号数据库路径 |
| `CANVAS_ASSET_DIR` | 持久素材目录 |
| `CANVAS_IMAGE_SCRIPT` | 外部图片生成脚本的绝对路径 |
| `TUZI_CODING_API_KEY` | 服务端图片生成密钥 |
| `CANVAS_PUBLIC_ORIGIN` | 团队模式的 HTTPS 域名 |
| `CANVAS_TEXT_AI_HOSTS` | 团队模式允许的文本 AI HTTPS 域名，英文逗号分隔 |

密钥只通过服务环境配置，不要放入前端或提交到仓库。团队部署需使用同机 HTTPS 反向代理，详见 [受邀团队部署与验收](deploy/team-beta.md) 和 [Caddy 配置模板](deploy/Caddyfile.example)。

域名与 TLS、真实生成服务、备份恢复和目标负载仍需在实际部署环境验收。本仓库的提交不代表已完成公网部署。

## 验证

后端测试使用临时账号与素材目录，并模拟图片生成提供方，不发起付费生成：

```powershell
python -m unittest discover -s tests -p "test_*.py"
```

浏览器回归需要 Node.js、`playwright` 和 Google Chrome；测试脚本目前使用 Windows 默认 Chrome 路径，其他环境需调整对应启动配置。回归脚本位于 `tests/*.cjs`，视觉检查入口为 `qa/visual-review.cjs`。测试所用图片与视频夹具随仓库提供，其余截图、导出文件和日志均忽略。

## 项目结构

- `index.html`、`app.js`、`styles.css`：画布工作台。
- `presentation.*`、`scene-*.js`、`prompt-editor.js`：HTML PPT 与元素编辑。
- `canvas-media.js`、`media-runtime.js`：媒体展示和导出。
- `login.*`、`account-client.js`、`admin*`：账号界面与管理台。
- `server.py`、`auth_store.py`、`media_store.py`、`image_generation.py`：本地服务与数据接口。
- `deploy/`、`tests/`：部署说明与回归测试。
- `Canvas_OS_产品愿景与前端设计规格_v1.docx`：原始产品规格。
