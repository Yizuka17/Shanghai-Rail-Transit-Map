# Shanghai Rail Transit Map

一个按真实地理位置绘制上海轨道交通线路的交互地图。

当前版本是纯静态网页，可直接部署到 Cloudflare Pages、GitHub Pages 或任何静态文件托管服务，不需要后端。

## 当前实现

- Leaflet 负责地图交互，OpenFreeMap + MapLibre 提供矢量底图
- 默认使用 OpenFreeMap `Liberty` 样式，可显示道路、河川、绿地、建筑等城市地理要素
- 上海地铁 1–18 号线、浦江线、磁浮线、市域机场线的线路配置
- 使用上海轨道交通线路色显示线路
- 直接从 OpenStreetMap 官方 API 读取 relation，并在浏览器端转换为真实轨道 GeoJSON
- 自动尝试从上海地铁 network relation 发现各线路当前的 route_master，减少硬编码 relation 失效的问题
- 线路单独显示 / 隐藏、地铁 / 其他轨交筛选
- 可选车站标注，换乘站按名称自动合并
- 桌面端与移动端响应式界面

此前版本通过 `openstreetmap.tools/public_transport_geojson` 跨域读取线路。该服务没有为第三方网页提供 CORS 响应头，因此部署到独立域名后浏览器会阻止读取，导致线路全部无法显示。当前版本已移除这一运行时依赖。

## 文件结构

```text
.
├── index.html    # 页面结构与地图依赖
├── styles.css    # UI 与地图样式
├── lines.js      # 线路元数据、颜色与 relation 后备配置
└── app.js        # 地图渲染、OSM relation 解析与交互逻辑
```

## 部署

这是无构建步骤的静态站点。Cloudflare Pages 连接本仓库后：

- Framework preset: `None`
- Build command: 留空
- Build output directory: `/`（仓库根目录）

如果 Pages 配置要求输出目录，可将整个仓库根目录作为静态资源目录。

## 数据与地图

底图使用 OpenFreeMap，地图数据来自 OpenStreetMap / OpenMapTiles。轨道几何从 OpenStreetMap 官方 API 的 relation 数据生成；线路颜色参考上海地铁公开线路配色。

OpenStreetMap 数据 © OpenStreetMap contributors，遵循 ODbL。

当前仍属于原型阶段。长期方案会把轨交 GeoJSON 预生成并随仓库静态发布，避免每位访客首次打开页面时都直接请求 OSM API，也方便加入人工校正后的轨道几何。

## 后续

继续确认 14、15 号线、市域机场线的 relation 与显示效果，随后加入市域铁路、松江有轨电车、临港中运量等上海轨道 / 中运量系统，并将不同制式做成独立图层。
