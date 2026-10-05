/**
 * 歌词注音排布规范化：按歌词字体量宽，把溢出压字的相邻注音合并成整体注音
 */

import type { LyricLanguage, LyricLine } from "lyric-kit";
import { type RubyWidthMeasurer, normalizeRubyLayout } from "lyric-kit";

/** 注音量宽用到的歌词字体，与 FullPlayer 写进歌词容器和各语言选择器的设置一致 */
export interface RubyLyricFont {
  fontFamily: string;
  fontWeight: number;
  fontFamilyLatin: string;
  fontFamilyJapanese: string;
  fontFamilyKorean: string;
  fontFamilyChinese: string;
}

/**
 * 量宽参考字号（px）
 *
 * 判定只比较正文与注音的相对位置，与歌词实际字号无关；取大字号以降低浮点误差。
 */
const REFERENCE_FONT_SIZE = 128;

/** 行宽缓存条数上限，超出即清空，避免长歌词叠加换字体时无界增长 */
const MAX_CACHED_WIDTHS = 4096;

let measureContext: CanvasRenderingContext2D | null | undefined;

/** 字号比例 + 字体 + 文本 → 行内宽度，同一字体下重复文本直接复用 */
const widthCache = new Map<string, number>();

let cacheFontKey = "";

/** 字体加载批次，变化时让显示层重新量宽 */
const fontsRevision = ref(0);

let fontsWatched = false;

/** 基于回退字体的首次测量并不可靠，Web 字体加载完成后重算一次 */
const watchFontLoading = (): void => {
  if (fontsWatched || !document.fonts) return;
  fontsWatched = true;
  const bump = (): void => {
    fontsRevision.value += 1;
  };
  document.fonts.addEventListener("loadingdone", bump);
  void document.fonts.ready.then(bump);
};

/**
 * 拼出各自主语言在渲染层实际生效的字体列表
 * @param font - 歌词字体设置
 * @returns 行主语言（无语言时为空串）到 CSS font-family 的映射
 */
const resolveFamilies = (font: RubyLyricFont): Record<LyricLanguage | "", string> => {
  const quoted = (family: string): string => `"${family.replaceAll('"', "")}"`;
  const base = font.fontFamily ? [quoted(font.fontFamily)] : [];
  const build = (languageFont: string): string =>
    [...(languageFont ? [quoted(languageFont)] : []), ...base, "sans-serif"].join(", ");

  return {
    "": build(""),
    ja: build(font.fontFamilyJapanese),
    ko: build(font.fontFamilyKorean),
    "zh-CN": build(font.fontFamilyChinese),
    "und-Latn": build(font.fontFamilyLatin),
  };
};

/**
 * 创建按行主语言切换字体的行内宽度测量函数
 * @param font - 歌词字体设置
 * @returns 测量函数，量不到宽度时返回 null
 */
const createRubyMeasurer = (font: RubyLyricFont): RubyWidthMeasurer | null => {
  const context = (measureContext ??= document.createElement("canvas").getContext("2d"));
  if (!context) return null;

  const families = resolveFamilies(font);
  const fontKey = `${fontsRevision.value}|${font.fontWeight}|${Object.values(families).join("|")}`;
  if (fontKey !== cacheFontKey) {
    cacheFontKey = fontKey;
    widthCache.clear();
  }

  let appliedFont = "";
  return (text, ratio, language) => {
    const family = families[language ?? ""];
    const cacheKey = `${ratio}|${family}|${text}`;
    const cached = widthCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const nextFont = `${font.fontWeight} ${(REFERENCE_FONT_SIZE * ratio).toFixed(2)}px ${family}`;
    if (nextFont !== appliedFont) {
      appliedFont = nextFont;
      context.font = nextFont;
    }

    const width = context.measureText(text).width;
    if (widthCache.size >= MAX_CACHED_WIDTHS) widthCache.clear();
    widthCache.set(cacheKey, width);
    return width;
  };
};

/**
 * 消除歌词行中相邻注音的边界重叠
 * @param lines - 歌词行数组
 * @param font - 歌词字体设置，用于量取正文与注音的行内宽度
 * @returns 规范化后的歌词行数组，无需合并或量不到宽度时返回入参数组
 */
export const normalizeLyricRubyLayout = (lines: LyricLine[], font: RubyLyricFont): LyricLine[] => {
  const hasRuby = lines.some((line) => line.words.some((word) => (word.ruby?.length ?? 0) > 0));
  if (!hasRuby) return lines;

  watchFontLoading();
  const measure = createRubyMeasurer(font);
  return measure ? normalizeRubyLayout(lines, measure) : lines;
};
