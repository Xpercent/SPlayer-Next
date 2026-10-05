import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { afterAll, describe, expect, it } from "vitest";
import { normalizeLyricRubyLayout } from "./rubyLayout";

/** 量宽调用记录：文本 + 当时的 font 字符串 */
const measured: { font: string; text: string }[] = [];

const originalGetContext = HTMLCanvasElement.prototype.getContext;

/**
 * 假画布量宽：每个图素见方，字号取 font 字符串里的 px 值
 *
 * 因此正文每字 128，注音（0.5 比例）每字 64，2 个假名正好占满 1 个正文图素。
 */
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement): unknown {
  const context = {
    font: "",
    measureText: (text: string): { width: number } => {
      const fontSize = Number.parseFloat(context.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "") || 128;
      measured.push({ text, font: context.font });
      return { width: Array.from(text).length * fontSize };
    },
  };
  return context;
} as unknown as typeof originalGetContext;

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

const font = {
  fontFamily: "Base Font",
  fontWeight: 700,
  fontFamilyLatin: "",
  fontFamilyJapanese: "Noto Sans JP",
  fontFamilyKorean: "",
  fontFamilyChinese: "",
};

const rubyWord = (
  word: string,
  kanaList: string[],
  startTime: number,
  endTime: number,
): LyricWord => ({
  word,
  startTime,
  endTime,
  ruby: kanaList.map((kana, index) => ({
    word: kana,
    startTime: startTime + index,
    endTime: endTime - index,
  })),
});

const toLine = (language: LyricLine["language"], ...words: LyricWord[]): LyricLine => ({
  language,
  words,
  translatedLyric: "",
  romanLyric: "",
  startTime: 0,
  endTime: 1000,
  isBG: false,
  isDuet: false,
});

describe("normalizeLyricRubyLayout", () => {
  it("溢出压字的相邻注音被合并为整体注音", () => {
    const lines = normalizeLyricRubyLayout(
      [toLine("ja", rubyWord("物", ["もの"], 0, 500), rubyWord("語", ["がたり"], 500, 1000))],
      font,
    );

    expect(lines[0].words.map((word) => word.word)).toEqual(["物語"]);
    expect(lines[0].words[0].ruby?.map((span) => span.word)).toEqual(["ものがたり"]);
  });

  it("注音占满正文宽度时不合并", () => {
    const source = [
      toLine("ja", rubyWord("本", ["ほん"], 0, 500), rubyWord("当", ["とう"], 500, 1000)),
    ];

    expect(normalizeLyricRubyLayout(source, font)).toBe(source);
  });

  it("按行主语言选字体，未设置语言字体时回退通用歌词字体", () => {
    measured.length = 0;
    normalizeLyricRubyLayout([toLine("ja", rubyWord("私", ["わたし"], 0, 500))], font);
    normalizeLyricRubyLayout([toLine("zh-CN", rubyWord("偶", ["ぐう"], 0, 500))], font);

    const fontStrings = measured.map((entry) => entry.font);
    expect(fontStrings.some((value) => value.includes('"Noto Sans JP"'))).toBe(true);
    expect(
      fontStrings.some((value) => !value.includes("Noto Sans JP") && value.includes('"Base Font"')),
    ).toBe(true);
  });

  it("同一字体下重复文本复用行宽缓存", () => {
    const line = () =>
      toLine("ja", rubyWord("花", ["はな"], 0, 500), rubyWord("火", ["ひ"], 500, 1000));
    const lines = [line(), line()];
    measured.length = 0;
    normalizeLyricRubyLayout(lines, font);
    const firstPass = measured.length;

    normalizeLyricRubyLayout(lines, font);

    expect(firstPass).toBeGreaterThan(0);
    expect(measured.length).toBe(firstPass);
  });

  it("字体设置变更时作废旧的行宽缓存", () => {
    normalizeLyricRubyLayout([toLine("ja", rubyWord("海", ["うみ"], 0, 500))], font);
    measured.length = 0;

    normalizeLyricRubyLayout([toLine("ja", rubyWord("海", ["うみ"], 0, 500))], {
      ...font,
      fontWeight: 400,
    });

    expect(measured.length).toBeGreaterThan(0);
  });

  it("整首没有注音时不量宽也不改动数据", () => {
    const source = [toLine("ja", { word: "あ", startTime: 0, endTime: 500 })];
    measured.length = 0;

    expect(normalizeLyricRubyLayout(source, font)).toBe(source);
    expect(measured).toHaveLength(0);
  });
});
