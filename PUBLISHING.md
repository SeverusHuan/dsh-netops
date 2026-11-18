# 发布指南

从零到上架，一共四步。前两步需要你的账号，后两步可以我来做（给我仓库地址即可）。

---

## 0. 先改掉占位符

`package.json` 里的 `OWNER` 是你 GitHub 用户名：

```powershell
cd H:\网络问题\dsh-netops
npm pkg set "repository.url=git+https://github.com/你的用户名/dsh-netops.git"
npm pkg set "homepage=https://github.com/你的用户名/dsh-netops#readme"
npm pkg set "bugs.url=https://github.com/你的用户名/dsh-netops/issues"
```

`docs/market-entry.yml` 里的 `OWNER` 同样替换（提交市场时用）。

---

## 1. 推到 GitHub

没有 `gh` CLI，用网页建仓最省事：<https://github.com/new> →
名字 `dsh-netops`、Public、**不要**勾选 README / .gitignore / license（本地已经有了）。

```powershell
cd H:\网络问题\dsh-netops
git remote add origin https://github.com/你的用户名/dsh-netops.git
git push -u origin main
```

推送后在仓库页面右侧 **About** 里加 topic：`dsh-plugin`（收录的硬性要求之一）。
再加一句 Description，和 `package.json` 的 description 保持一致。

---

## 2. 发布到 npm（可选，但推荐）

上架**不要求** npm 包；但发了 npm，市场里能显示下载量，安装也免掉「从源码构建」的授权步骤。

```powershell
npm login                     # 浏览器里授权一次
npm publish                   # package.json 里已配 publishConfig.access=public
```

发完检查：<https://www.npmjs.com/package/dsh-netops>

以后每次改版本：

```powershell
npm version patch             # 或 minor / major，会自动打 tag
git push --follow-tags
npm publish
```

> 包名 `dsh-netops` 已确认在 npm 上没人占（2026-11-18 查询 404）。若以后被抢注，改用 `@你的npm名/dsh-netops`。

---

## 3. 上架插件市场（awesome-dsh-plugin）

市场（dsh-market 插件、dshmarket.com、awesome-dsh-plugin.com）的**唯一数据源**是仓库
[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。

**投稿方式：一个文件，一个 PR。**

1. Fork 那个仓库。
2. 新建 `data/plugins/<owner>__dsh-netops.yml`，内容复制 `docs/market-entry.yml`（把 OWNER 换成你的用户名）。
3. 提 PR。合并后站点自动重建，通常一天内出现在市场里。

硬性要求（都满足）：

- [x] `package.json` 声明 `dsh.bundle`（本仓库已有）
- [x] 仓库有真实可用代码（不是占位）
- [ ] 仓库创建满 1 天（当天建仓当天提 PR 会被 CI 拦，隔天再提即可）
- [ ] 仓库加 `dsh-plugin` topic
- [ ] 描述属实——维护者会对着代码核，别写没实现的功能

分类选 `tools`（工具类）。**注意：M2 下发、M3 页面做出来之前，描述里只能写巡检。**

---

## 4. 让 DSH 自己的「发现」页也能搜到（可选）

DSH 插件页 → **发现（Discover）→ 索引源（Index sources）**，可以添加任意 format-1 索引 URL。

- 加公共目录：`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`
- 加你自己的索引（例如放在本仓库的 GitHub Pages 或 raw 地址），格式见
  `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex`：

```json
{
  "format": 1,
  "title": "dsh-netops",
  "plugins": [
    {
      "name": "dsh-netops",
      "title": { "en": "Network operations", "zh": "网络运维" },
      "description": { "en": "…", "zh": "…" },
      "repository": { "url": "https://github.com/你的用户名/dsh-netops" },
      "versions": [
        {
          "version": "0.2.0",
          "publishTimestamp": 1763440000,
          "source": { "type": "npm" }
        }
      ]
    }
  ]
}
```

> 索引走 `git` 源时，`source` 要写 `{"type":"git","url":"https://github.com/…/dsh-netops","commit":"<40 位 commit>"}`，
> 装的是钉死的那次提交。

---

## 发布前自查清单

```powershell
npm pack --dry-run      # 看包里到底有什么（不该有 netops.local.json / runs / devices.json）
node --check index.js   # 语法
git status              # 干净
```

- [ ] 仓库里没有密码、没有内网地址（`netops.local.json` 已在 .gitignore）
- [ ] README 的安装命令可用
- [ ] 插件在干净 profile 里能装能跑（换一台机器试，或删掉 rootDir 重来）
- [ ] `engines.dsh` 与当前宿主版本相符（现在是 `>=0.2.2-0`）

---

## 版本与路线图的关系

| 版本 | 内容 |
|---|---|
| 0.2.0 | 巡检（H3C）+ 运行时长 + 报告（当前） |
| 0.3.0 | 配置下发（模板/变量/预览/备份/串行/回读） |
| 0.4.0 | 配置编写页面 + 多厂商 profile |
| 0.5.0 | 安全设备网页截图巡检 |

每个版本都单独发一次 npm 与 GitHub Release，市场条目只需要第一次 PR，之后不用再提。
