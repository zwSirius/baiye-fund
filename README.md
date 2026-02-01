# SmartFund - 智能养基宝

SmartFund 是一款现代化的基金投资助手，基于 React + FastAPI 构建。它利用 AI (Gemini) 进行持仓分析，并提供实时净值估算（基于重仓股实时涨跌幅）。

## ✨ 核心特性

*   **实时估值**：不依赖官方单一数据，基于持仓重仓股实时计算估值。
*   **AI 智能分析**：集成 Google Gemini API，一键生成持仓诊断报告。
*   **隐私安全**：支持 API Key 私有化配置，支持一键隐私模式（隐藏金额）。
*   **多维度管理**：支持多账户分组、自选观察、收益日历、组合回测。
*   **现代化 UI**：移动端优先设计，支持深色模式。

## 🛠️ 技术栈

*   **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons, Recharts
*   **Backend**: FastAPI, Akshare (金融数据源), Pandas
*   **AI**: Google Gemini API

## 🚀 快速开始

### 本地开发

1.  **启动后端**
    ```bash
    cd backend
    pip install -r requirements.txt
    # 设置 Gemini Key (可选，用于 AI 分析)
    export GEMINI_API_KEY="your_api_key"
    python main.py
    # 后端运行在 http://127.0.0.1:7860
    ```

2.  **启动前端**
    ```bash
    # 回到根目录
    npm install
    npm run dev
    # 前端运行在 http://localhost:5173
    ```

### ☁️ 部署 (Zeabur)

本项目可直接部署于 [Zeabur](https://zeabur.com)。

1.  **创建服务**：
    *   在 Zeabur 创建一个 Project。
    *   连接 GitHub 仓库。
    *   Zeabur 会自动识别并创建两个服务（Node.js 前端 和 Python 后端）。

2.  **配置后端 (Python Service)**：
    *   **Root Directory**: 设为 `backend` (如果你的 backend 文件夹在根目录下)。
    *   **Variables**: 添加 `GEMINI_API_KEY` (可选)。
    *   获取后端服务的 **Domain** (例如 `https://api.xxxx.zeabur.app`)。

3.  **配置前端 (Node.js Service)**：
    *   **Build Command**: `npm run build`
    *   **Output Directory**: `dist`
    *   **Variables**: 添加 `VITE_API_BASE`，值为后端的 Domain (例如 `https://api.xxxx.zeabur.app`)。这一步至关重要，否则前端无法连接后端。

## 📝 注意事项

*   **Akshare 数据源**：部分金融数据接口依赖第三方源，可能会有偶尔的不稳定或延迟。
*   **AI 配额**：公共通道可能存在请求限制，建议在 App 设置中填入自己的 Gemini API Key 以获得最佳体验。
