import { describe, expect, it } from "vitest";
import { suggestProductImageUrl } from "@/lib/brand-theme";
import {
  selectFazerCardsCategoriesForQuery,
  splitFazerCardsSearchQuery,
  type FazerCardsGiftCardCategory,
} from "@/lib/server/suppliers/fazercards";

const SAMPLE_CATEGORIES: FazerCardsGiftCardCategory[] = [
  ...["ae", "ar", "at", "au", "be", "bh", "br", "ca", "ch", "cz", "de", "es", "fi", "fr", "hk", "hr", "hu", "id", "ie", "it", "jp", "kw", "lb", "lu", "my", "nl", "nz", "om", "pt", "qa"].map(
    (code) => ({
      category_id: `playstation_${code}`,
      name: `PlayStation (${code.toUpperCase()})`,
      note: `Region: ${code.toUpperCase()}\nPlayStation gift cards.`,
    })
  ),
  {
    category_id: "playstation_us",
    name: "PlayStation (US)",
    note: "Region: US\nPlayStation gift cards.",
  },
  {
    category_id: "playstation_za",
    name: "PlayStation (ZA)",
    note: "Region: ZA\nPlayStation gift cards.",
  },
  {
    category_id: "netflix_us",
    name: "Netflix (US)",
    note: "Region: US\nNetflix gift cards.",
  },
  {
    category_id: "music_box",
    name: "Music Box Gift",
    note: "Global digital audio card.",
  },
];

describe("FazerCards search & US prioritization", () => {
  it("finds PlayStation (US) at rank #1 even when 30+ regional categories precede it alphabetically", () => {
    const byPlainBrand = selectFazerCardsCategoriesForQuery(SAMPLE_CATEGORIES, "playstation", 24);
    expect(byPlainBrand[0]?.category.category_id).toBe("playstation_us");

    const byFullProductName = selectFazerCardsCategoriesForQuery(
      SAMPLE_CATEGORIES,
      "PlayStation Store Gift Card (USA)",
      24
    );
    expect(byFullProductName[0]?.category.category_id).toBe("playstation_us");

    const bySpacedUs = selectFazerCardsCategoriesForQuery(
      SAMPLE_CATEGORIES,
      "playstation us 25",
      24
    );
    expect(bySpacedUs[0]?.category.category_id).toBe("playstation_us");
    expect(bySpacedUs.some((e) => e.category.category_id === "playstation_ae")).toBe(false);
  });

  it("prioritizes true _us / (US) categories ahead of words like music when searching 'us'", () => {
    const byUs = selectFazerCardsCategoriesForQuery(SAMPLE_CATEGORIES, "us", 10);
    const ids = byUs.map((e) => e.category.category_id);
    expect(ids.slice(0, 2)).toEqual(expect.arrayContaining(["netflix_us", "playstation_us"]));
    expect(ids.indexOf("playstation_us")).toBeLessThan(ids.indexOf("music_box"));
  });

  it("extracts non-filler brand/region tokens separately from numeric denomination tokens", () => {
    expect(splitFazerCardsSearchQuery("PlayStation Store Gift Card (USA) $25")).toEqual({
      categoryTokens: ["playstation", "usa"],
      offerTokens: ["playstation", "usa", "25"],
      numericTokens: ["25"],
    });
  });

  it("suggests brand-appropriate default card images across core and FazerCards brands", () => {
    expect(suggestProductImageUrl("PlayStation Store (USA)")).toBe("/cards/playstation.png");
    expect(suggestProductImageUrl("Xbox Gift Card (USA)")).toBe("/cards/xbox.png");
    expect(suggestProductImageUrl("Xbox Game Pass Ultimate", "fazer:xbox_game_pass_au")).toBe(
      "/cards/xbox-gamepass.png"
    );
    expect(suggestProductImageUrl("Steam Wallet")).toBe("/cards/steam.png");
    expect(suggestProductImageUrl("App Store & iTunes (US)")).toBe("/cards/apple.png");
    expect(suggestProductImageUrl("Google Play (US)")).toBe("/cards/googleplay.png");
    expect(suggestProductImageUrl("Amazon")).toBe("/cards/amazon.png");
    expect(suggestProductImageUrl("Valorant VP")).toBe("/cards/valorant.png");
    expect(suggestProductImageUrl("League of Legends RP")).toBe("/cards/leagueoflegends.png");
    expect(suggestProductImageUrl("Wild Rift WC")).toBe("/cards/leagueoflegends.png");
    expect(suggestProductImageUrl("Riot Access Code (US)")).toBe("/cards/riot.png");
    expect(suggestProductImageUrl("Fortnite Packs", "fazer:fortnite_packs_xbox_ar")).toBe(
      "/cards/fortnite.png"
    );
    expect(suggestProductImageUrl("EA Gift Cards")).toBe("/cards/ea.png");
    expect(suggestProductImageUrl("EA SPORTS FC 26")).toBe("/cards/ea.png");
    expect(suggestProductImageUrl("Sea of Thieves")).not.toBe("/cards/ea.png");
    expect(suggestProductImageUrl("Discord Gift Card")).toBe("/cards/discord.png");
    expect(suggestProductImageUrl("Tinder Plus")).toBe("/cards/tinder.png");
    expect(suggestProductImageUrl("Minecraft Java & Bedrock")).toBe("/cards/minecraft.png");
    expect(suggestProductImageUrl("Battle.net Gift Cards")).toBe("/cards/battlenet.png");
    expect(suggestProductImageUrl("World of Warcraft")).toBe("/cards/wow.png");
    expect(suggestProductImageUrl("Garena Shells")).toBe("/cards/freefire.png");
    expect(suggestProductImageUrl("Adobe Digital Code")).toBe("/cards/adobe.png");
    expect(suggestProductImageUrl("Telegram Stars")).toBe("/cards/telegram.png");
    expect(suggestProductImageUrl("MasterCard Gift Card")).toBe("/cards/mastercard.png");
    expect(suggestProductImageUrl("AstroPay")).toBe("/cards/astropay.png");
    expect(suggestProductImageUrl("Rewarble")).toBe("/cards/rewarble.png");
  });
});
