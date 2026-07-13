/**
 * 分类（Issue #9：自定义分类）。
 * 分类是任务上的自由文本，没有独立的分类表。下拉可选项 = 默认 5 类 ∪ 用户已用过的分类。
 * 已用分类由 GET /categories 提供（见 store.categories），本模块只放常量与纯工具。
 */

export const DEFAULT_CATEGORIES = ['学习', '工作', '生活', '家庭', '其他'] as const

/** 合并默认分类与已用分类，去重、默认在前、其余按已有顺序追加。 */
export function mergeCategories(used: string[]): string[] {
  const out: string[] = [...DEFAULT_CATEGORIES]
  for (const c of used) {
    const v = c.trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}

/** 校验单个分类：非空且 ≤10 字符（对齐后端 VARCHAR(10)）。 */
export function isValidCategory(c: string): boolean {
  const v = c.trim()
  return v.length > 0 && [...v].length <= 10
}

/** 是否为默认分类（默认分类不可删除/重命名）。 */
export function isDefaultCategory(c: string): boolean {
  return (DEFAULT_CATEGORIES as readonly string[]).includes(c)
}
