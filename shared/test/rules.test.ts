import { describe, expect, it } from "vitest";
import {
  analyzeCards,
  canBeat,
  createDeck,
  hasSpecialWin,
  type Card
} from "../src/index";

function cards(ranks: Card["rank"][]): Card[] {
  return ranks.map((rank, index) => ({ id: `${rank}-${index}`, rank }));
}

describe("card analysis", () => {
  it("recognizes supported sets", () => {
    expect(analyzeCards(cards(["7"]))?.type).toBe("single");
    expect(analyzeCards(cards(["5", "5"]))?.type).toBe("pair");
    expect(analyzeCards(cards(["2", "2", "2"]))?.type).toBe("triple");
    expect(analyzeCards(cards(["9", "10", "J"]))?.type).toBe("straight");
    expect(analyzeCards(cards(["3", "3", "3", "3"]))?.type).toBe("bomb");
  });

  it("rejects unsupported shapes", () => {
    expect(analyzeCards(cards(["K", "K", "K", "3"]))).toBeNull();
    expect(analyzeCards(cards(["small-joker", "big-joker", "7"]))).toBeNull();
    expect(analyzeCards(cards(["2", "3", "5"]))).toBeNull();
    expect(analyzeCards(cards(["small-joker", "big-joker", "small-joker", "big-joker"]))).toBeNull();
  });
});

describe("comparison rules", () => {
  it("allows only same type and same length outside bombs", () => {
    const pairSeven = analyzeCards(cards(["7", "7"]));
    const singleThree = analyzeCards(cards(["3"]));
    const pairFive = analyzeCards(cards(["5", "5"]));

    expect(pairSeven && singleThree && canBeat(pairSeven, singleThree)).toBe(false);
    expect(pairSeven && pairFive && canBeat(pairSeven, pairFive)).toBe(true);
  });

  it("lets bombs beat non-bombs and compares bombs by rank", () => {
    const bombFour = analyzeCards(cards(["4", "4", "4", "4"]));
    const bombFive = analyzeCards(cards(["5", "5", "5", "5"]));
    const singleSeven = analyzeCards(cards(["7"]));

    expect(bombFour && singleSeven && canBeat(bombFour, singleSeven)).toBe(true);
    expect(bombFive && bombFour && canBeat(bombFive, bombFour)).toBe(true);
    expect(bombFour && bombFive && canBeat(bombFour, bombFive)).toBe(false);
  });
});

describe("win conditions", () => {
  it("recognizes special 7-wang-5-2-3 hand", () => {
    expect(hasSpecialWin(cards(["7", "small-joker", "5", "2", "3"]))).toBe(true);
    expect(hasSpecialWin(cards(["7", "K", "5", "2", "3"]))).toBe(false);
  });

  it("creates a standard 54 card deck", () => {
    expect(createDeck()).toHaveLength(54);
  });
});
