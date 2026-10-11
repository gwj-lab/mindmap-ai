---
annotationId: c2975db1-626f-41d4-bdf1-fc04750b31d8
tags:
  - 答疑
id: qa-c2975db1-626f-41d4-bdf1-fc04750b31d8
provider: chatgpt
title: 残差
sourceUrl: https://chatgpt.com/
sourceMessageId: assistant-60be63b78d76d80d
contentHash: fd5da38d29132b649b243981f7055c6255493a378117448b7d22a8486631d993
capturedAt: 2026-10-11T18:14:54.492Z
updatedAt: 2026-10-11T18:14:58.244Z
---
## 答疑回答

带截距的最小二乘回归使残差之和为零。

-   用例子验证

| 模型 | 残差和 |
| --- | --- |
| 带截距 | 0 |

```python
sum(residuals)
```

## 提问

> 为什么这个模型的残差和为零？请比较带截距与不带截距的情况。

## 批注来源

- [回归模型](source.md)

  > 模型  中残差是观测值与预测值之差。