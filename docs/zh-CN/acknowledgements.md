# 来源与致谢

SerialCanvas 的前身是 [SerialWeb](https://github.com/Conductance-lab/SerialWeb)，由**电导实验室（Conductance-lab）**创建并维护（原作者主页 <https://conductance-lab.xyz>，原在线版本 <https://conductance-lab.xyz/SerialWeb/>）。本项目以上游 `v1.6`（提交 `e3f9200814`，2026/9/6）为起点，此后独立发展——已不再是 fork，两者也没有共同的 upstream 分支。

界面设计借鉴了两个项目：

- **SerialWeb** —— 本项目出发时的原始界面。
- **[PICOTTY](https://github.com/morpheuslord/PICOTTY)**（morpheuslord）—— 三栏 fleet console（nodes │ console │ activity），现代主义布局由此而来；此外还有可见的控制字节条、行级相对时间戳、随视口伸缩的侧栏等小想法。

- [沿革](#沿革)
- [许可证](#许可证)

English mirror: [../acknowledgements.md](../acknowledgements.md).

## 沿革

| | |
| --- | --- |
| 原始项目 | [`Conductance-lab/SerialWeb`](https://github.com/Conductance-lab/SerialWeb) |
| 起点 | 上游 `v1.6`，提交 `e3f9200814`（2026/9/6） |
| 本仓库 | [`ra9fael/SerialCanvas`](https://github.com/ra9fael/SerialCanvas)，自 `v0.2.0` 起作为独立项目编号 |
| UI 借鉴 | SerialWeb · [PICOTTY](https://github.com/morpheuslord/PICOTTY) |

起点之前的设计与每一行代码都归原作者；之后的一切在本仓库开发。两部分一律适用同一[许可证](#许可证)。

## 许可证

SerialCanvas 采用 **AGPL-3.0**，与原项目声明的许可证一致。改名不改变义务：LICENSE 文件随仓库分发，原始版权声明保持归属，本页面即「相对原版的修改」的正式声明。内部标识（如剪贴板配置的 `SerialWebUserConfig` 类型）刻意保留原名，以便旧版本导出的配置仍能导入。
