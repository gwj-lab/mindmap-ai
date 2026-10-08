# Markdown 保存效果全项测试（2026-10-05）

## 1\. 标题与基础文本

### 三级标题示例

#### 四级标题示例

这是一段中文普通文本，用于测试段落、标点符号、换行与中英文混排是否能够完整保存。

This is an English paragraph for testing Markdown rendering, text preservation, and mixed-language content.

格式测试：**这是加粗文本**，_这是斜体文本_，~这是删除线文本~。行内代码示例：`const price = "$9.99";`，其中包含双引号和美元符号；反引号字符可写作 `` ` ``。

## 2\. 列表

无序列表：

-   苹果
-   香蕉
    -   一级嵌套项目 A
    -   一级嵌套项目 B
        -   二级嵌套项目
-   橙子

有序列表从 3 开始：

3.  第三个项目
4.  第四个项目
5.  第五个项目

任务列表：

-   [x] Markdown 文本保存
-   [x] 公式录入
-   [ ] 人工检查最终渲染
-   [ ] 导出后再次比对

## 3\. 引用与分隔线

> 这是一段引用文本，用于检查引用样式。  
> 引用中也可以出现 **加粗内容**，以及普通文字。

* * *

## 4\. 代码块

JavaScript：

```javascript
// 异步函数测试
async function fetchValue() {
  const message = "Markdown test";
  const count = 2026;

  await Promise.resolve();
  console.log(message, count);
  return "$100";
}

fetchValue();
```

Python：

```python
def square(x):
    """Return x squared."""
    result = x ** 2
    print("result =", result)
    return result

square(5)
```

纯文本代码块，以下内容应保持字面形式，不应渲染为公式或 Markdown：

```text
LaTeX literal: \frac{a}{b}, x^{2}, \int_0^1 x\,dx
Markdown literal: **bold** _italic_ [link](https://example.com)
Heading literal: ## This should NOT become a heading
Inline math literal: $E = mc^2$
```

## 5\. 四列表格

| 左对齐 | 居中 | 右对齐 | 混合内容 |
| :-- | :-: | --: | :-- |
| 普通文本 | **加粗文本** | 123.45 | `code()` |
| 第二行 | [MDN](https://developer.mozilla.org/) | 9,876 | $\frac{1}{2}$ |
| 中文 | `x = 42` | 2026 | **Markdown** 测试 |

## 6\. 数学公式

行内公式：分数 $\frac{a+b}{c}$，上标 $x^2$，下标 $a_1$，同时包含上下标的形式为 $x_i^2$。

Beta 与 Gamma 函数关系：

$$B(\alpha,\beta) = \frac{\Gamma(\alpha)\Gamma(\beta)} {\Gamma(\alpha+\beta)}$$

积分：

$$\int_{0}^{1} x^2\,dx = \frac{1}{3}$$

组合数：

$$\binom{n}{k} = \frac{n!}{k!(n-k)!}$$

二乘二矩阵：

$$A= \begin{pmatrix} a & b\\ c & d \end{pmatrix}$$

多行 `aligned` 方程：

$$\begin{aligned} y &= ax+b,\\ z &= y^2+1,\\ f(x) &= a^2x^2+2abx+b^2+1. \end{aligned}$$

嵌套分数：

$$R= \frac{ 1 }{ 1+\frac{ 1 }{ 2+\frac{1}{3} } }$$

带中文说明的公式：

$$E=mc^2 \qquad \text{其中 }E\text{ 表示能量，}m\text{ 表示质量。}$$

## 7\. 网页链接与真实来源引用

普通网页链接：[MDN JavaScript `async function`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function?utm_source=chatgpt.com)；[KaTeX Supported Functions](https://katex.org/docs/supported?utm_source=chatgpt.com)。

MDN 官方文档说明，`async function` 函数体内可以使用 `await`；每次调用异步函数都会返回一个新的 `Promise`。这与上面的 JavaScript 测试代码所展示的语法一致。[![](https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fdeveloper.mozilla.org&size=32&drop_404_icon=true)MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function "chatgpt-source")

KaTeX 官方的 Supported Functions 页面列出了其支持的 TeX 命令和环境，可用于核对 Markdown 阅读器是否正确支持 `\frac`、`\Gamma`、矩阵和其他数学语法。[![](https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fkatex.org&size=32&drop_404_icon=true)KaTeX](https://katex.org/docs/supported "chatgpt-source")

## 8\. 图片

![Python 标志](https://www.python.org/static/community_logos/python-logo.png)

## 9\. 最终验收表

| 检查项 | 预期结果 | 状态 |
| :-- | :-- | :-: |
| 内容保真 | 中文、英文及特殊字符无缺失 | ☐ |
| 公式完整 | 行内与独立 TeX 均正确渲染 | ☐ |
| 代码不丢换行 | JavaScript、Python、text 保留原始换行 | ☐ |
| 表格对齐 | 左、中、右对齐有效 | ☐ |
| 网页引用可点击 | 普通链接与真实来源引用均可访问 | ☐ |