# Shanghai Rail Transit Map

一个按真实地理位置绘制上海轨道交通线路的交互地图。

当前版本是纯静态网页，可直接部署到 Cloudflare Pages、GitHub Pages 或任何静态文件托管服务，不需要后端。

## 当前实现

- Leaflet 地图交互与 OpenStreetMap 底图
- 上海地铁 1–18 号线、浦江线、磁浮线、市域机场线的线路配置
- 使用上海轨道交通线路色显示线路
- OSM 公共交通 relation 的真实地理轨迹，已知 relation 的线路直接加载
- 线路单独显示 / 隐藏、地铁 / 其他轨交筛选
- 可选车站标注，换乘站自动合并
- 桌面端与移动端响应式界面

14、15 号线和市域机场线目前保留了配置入口，等待补入确认过的 OSM relation ID；页面不会因这些线路缺失而整体报错。

## 文件结构

```text
.
├── index.html    # 页面结构
├── styles.css    # UI 与地图样式
├── lines.js      # 线路元数据、颜色与 relation 配置
└── app.js        # 地图渲染、线路与车站交互逻辑
```

## 部署

这是无构建步骤的静态站点。Cloudflare Pages 连接本仓库后：

- Framework preset: `None`
- Build command: 留空
- Build output directory: `/`（仓库根目录）

如果 Pages 配置要求输出目录，可将整个仓库根目录作为静态资源目录。

## 数据与地图

地图底图和地理数据基于 OpenStreetMap。线路几何通过 public_transport_geojson 工具读取 OSM 公共交通 relation。线路颜色参考上海地铁公开线路配色。

OpenStreetMap 数据 © OpenStreetMap contributors，遵循 ODbL。

## 后续

计划继续补全 14、15 号线、市域机场线的 relation，随后加入市域铁路、松江有轨电车、临港中运量等上海轨道 / 中运量系统，并将不同制式做成独立图层。
