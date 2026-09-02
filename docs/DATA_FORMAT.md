# 行迹数据格式

## Envelope

导出文件和原生存储使用带版本号的 JSON envelope：

```json
{
  "app": "行迹",
  "version": 1,
  "updatedAt": "2026-09-02T12:00:00.000Z",
  "journeys": []
}
```

`app` 在部分内部存储文件中可以省略；`version` 和 `journeys` 是兼容性判断的核心字段。

## JourneyDay

```json
{
  "id": "journey-unique-id",
  "date": "2030-01-02",
  "purpose": "travel",
  "note": "可选备注",
  "legs": [
    {
      "id": "leg-unique-id",
      "from": "示例省甲市",
      "to": "示例省乙市",
      "transport": "road"
    }
  ]
}
```

### 字段约束

- `id`：数据集内唯一的非空字符串。
- `date`：本地自然日，格式为 `YYYY-MM-DD`。
- `purpose`：`study`、`family`、`travel`、`business` 之一。
- `note`：可选字符串。
- `legs`：至少包含一段路线，数组顺序即当天移动顺序。
- `from` / `to`：非空地点字符串，推荐使用“省级行政区 + 城市”全称。
- `transport`：`rail`、`air`、`road` 之一。

## 计算语义

同一天可以有多条 `JourneyDay`，也可以在一条记录中包含多段 `legs`。统计时：

1. 每段 `Leg` 单独计为一次交通移动。
2. 当天停留地点取当天最后一条记录的最后一个终点。
3. 没有移动的日期延续上一移动日的最终地点与目的。
4. 往返同一地点的当日移动不会改变后续停留目的。
5. “所有记录”的起点是数据集中最早的移动日期。

## 导入规则

导入器接受 envelope 或直接的 `JourneyDay[]`。应用会校验所有记录后再请求确认；任何一条记录不合法都会拒绝整个文件。导入是完整替换，不是增量合并。

## 版本演进

新增可选字段可以保持 `version: 1`。改变现有字段语义、枚举或必填关系时必须提升版本号，并在读取层提供显式迁移。
