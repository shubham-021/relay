/**
 * lib/tmdb.test.ts
 * Offline scoring tests for the TMDB match ranking (LIB_FIX_PLAN.md Phase 3).
 * Run: bun test lib/tmdb.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
  pickBestCandidate,
  normalizeTitle,
  titleSimilarity,
  isTitleMatch,
  getTitleVariants,
  type TmdbMatch,
} from "./tmdb";

function mk(id: number, title: string, year: string, extra: Partial<TmdbMatch> = {}): TmdbMatch {
  return {
    id,
    title,
    year,
    overview: null,
    posterPath: null,
    backdropPath: null,
    mediaType: "movie",
    popularity: 10,
    ...extra,
  };
}

describe("normalizeTitle", () => {
  test("lowercases and strips punctuation", () => {
    expect(normalizeTitle("The Sopranos")).toBe("sopranos");
    expect(normalizeTitle("Marvel's The Punisher")).toBe("marvel s the punisher");
  });
});

describe("titleSimilarity", () => {
  test("exact match = 1", () => {
    expect(titleSimilarity("Enemy", "Enemy")).toBe(1);
  });

  test("short title vs superset title is penalized", () => {
    // "enemy" should NOT score high against "enemy empire"
    const sim = titleSimilarity("enemy", "enemy empire");
    expect(sim).toBeLessThan(0.7);
  });

  test("punctuation/diacritics-insensitive", () => {
    expect(titleSimilarity("Amélie", "Amelie")).toBe(1);
  });
});

describe("pickBestCandidate", () => {
  const enemyPool: TmdbMatch[] = [
    mk(344656, "Enemy Empire", "2013", { popularity: 3 }),
    mk(522815, "Enemy", "2013", { popularity: 20 }),
    mk(223895, "Class Enemy", "2013", { popularity: 5 }),
    mk(181886, "Enemy", "2014", { popularity: 25 }),
  ];

  test("Enemy 2013 → the real Enemy, never Enemy Empire or Class Enemy", () => {
    const best = pickBestCandidate(enemyPool, { title: "Enemy", year: "2013", mediaType: "movie" });
    expect(best).not.toBeNull();
    expect(best!.id).not.toBe(344656); // Enemy Empire
    expect(best!.id).not.toBe(223895); // Class Enemy
    expect(normalizeTitle(best!.title)).toBe("enemy");
  });

  test("fuzzy junk is rejected when no exact match exists", () => {
    const pool = [mk(1, "Enemy Empire", "2013"), mk(2, "Class Enemy", "2013")];
    // Parsed title "Enemy" has no exact match in this pool → reject all rather than guess
    const best = pickBestCandidate(pool, { title: "Enemy", year: "2013", mediaType: "movie" });
    expect(best).toBeNull();
  });

  test("year proximity orders exact-title matches", () => {
    const best = pickBestCandidate(enemyPool, { title: "Enemy", year: "2014", mediaType: "movie" });
    expect(best!.id).toBe(181886);
  });

  test("region bonus disambiguates The Office US vs UK (tv)", () => {
    const pool: TmdbMatch[] = [
      mk(4417, "The Office", "2001", { mediaType: "tv", originCountry: ["GB"], popularity: 30 }),
      mk(2316, "The Office", "2005", { mediaType: "tv", originCountry: ["US"], popularity: 60 }),
    ];
    const bestUs = pickBestCandidate(pool, { title: "The Office", region: "us", mediaType: "tv" });
    expect(bestUs!.id).toBe(2316);
    const bestUk = pickBestCandidate(pool, { title: "The Office", region: "uk", mediaType: "tv" });
    expect(bestUk!.id).toBe(4417);
  });

  test("no region and no year → popularity tiebreak between exact matches", () => {
    const pool: TmdbMatch[] = [
      mk(4417, "The Office", "2001", { mediaType: "tv", originCountry: ["GB"], popularity: 30 }),
      mk(2316, "The Office", "2005", { mediaType: "tv", originCountry: ["US"], popularity: 60 }),
    ];
    const best = pickBestCandidate(pool, { title: "The Office", mediaType: "tv" });
    expect(best!.id).toBe(2316);
  });

  test("Stalker pool: exact title + exact year wins", () => {
    const pool = [mk(1398, "Stalker", "1979"), mk(1399, "Other Stalker", "1980")];
    const best = pickBestCandidate(pool, { title: "Stalker", year: "1979", mediaType: "movie" });
    expect(best!.id).toBe(1398);
  });

  test("A Silent Voice 2016 → matches 2016 anime movie (378064), not 2017 movie (1171702) [reported bug]", () => {
    const pool: TmdbMatch[] = [
      mk(1171702, "A Silent Voice", "2017", { popularity: 0.11 }),
      mk(378064, "A Silent Voice: The Movie", "2016", { popularity: 13.34 }),
    ];
    const best = pickBestCandidate(pool, {
      title: "A Silent Voice",
      year: "2016",
      mediaType: "movie",
    });
    expect(best).not.toBeNull();
    expect(best!.id).toBe(378064);
    expect(best!.title).toBe("A Silent Voice: The Movie");
    expect(best!.year).toBe("2016");
  });

  test("The Kubikiri Cycle → matches Kubikiri Cycle - Aoiro Savant to Zaregoto Tsukai (68460) [reported bug]", () => {
    const pool: TmdbMatch[] = [
      mk(68460, "Kubikiri Cycle -  Aoiro Savant to Zaregoto Tsukai", "2016", {
        mediaType: "tv",
        popularity: 4.2,
      }),
    ];
    const best = pickBestCandidate(pool, {
      title: "The Kubikiri Cycle",
      mediaType: "tv",
    });
    expect(best).not.toBeNull();
    expect(best!.id).toBe(68460);
  });

  test("Kaguya-sama → matches Kaguya-sama: Love Is War", () => {
    const pool: TmdbMatch[] = [
      mk(83097, "Kaguya-sama: Love Is War", "2019", {
        mediaType: "tv",
        popularity: 20,
      }),
    ];
    const best = pickBestCandidate(pool, {
      title: "Kaguya-sama",
      mediaType: "tv",
    });
    expect(best).not.toBeNull();
    expect(best!.id).toBe(83097);
  });

  test("Cowboy Bebop 2001 → matches Cowboy Bebop: The Movie (2001)", () => {
    const pool: TmdbMatch[] = [
      mk(11299, "Cowboy Bebop: The Movie", "2001", {
        mediaType: "movie",
        popularity: 15,
      }),
    ];
    const best = pickBestCandidate(pool, {
      title: "Cowboy Bebop",
      year: "2001",
      mediaType: "movie",
    });
    expect(best).not.toBeNull();
    expect(best!.id).toBe(11299);
  });

  test("Bakemono no Ko 2015 → matches The Boy and the Beast (315465) via alternativeTitles", () => {
    const pool: TmdbMatch[] = [
      mk(315465, "The Boy and the Beast", "2015", {
        mediaType: "movie",
        popularity: 10,
        alternativeTitles: [
          "Bakemono no Ko",
          "Le garçon et la bête",
          "The Boy and The Beast",
        ],
      }),
    ];
    const best = pickBestCandidate(pool, {
      title: "Bakemono no Ko",
      year: "2015",
      mediaType: "movie",
    });
    expect(best).not.toBeNull();
    expect(best!.id).toBe(315465);
    expect(best!.title).toBe("The Boy and the Beast");
  });
});

describe("isTitleMatch and getTitleVariants", () => {
  test("isTitleMatch matches base titles with subtitles, movie suffixes, and alternative titles", () => {
    expect(isTitleMatch("A Silent Voice", "A Silent Voice: The Movie")).toBe(true);
    expect(
      isTitleMatch("The Kubikiri Cycle", "Kubikiri Cycle -  Aoiro Savant to Zaregoto Tsukai")
    ).toBe(true);
    expect(isTitleMatch("Kaguya-sama", "Kaguya-sama: Love Is War")).toBe(true);
    expect(isTitleMatch("Bakemono no Ko", "The Boy and the Beast", ["Bakemono no Ko"])).toBe(true);
    expect(isTitleMatch("Enemy", "Enemy Empire")).toBe(false);
  });

  test("getTitleVariants extracts base title and strips tags", () => {
    const v1 = getTitleVariants("A Silent Voice: The Movie");
    expect(v1).toContain("A Silent Voice");

    const v2 = getTitleVariants("Kubikiri Cycle -  Aoiro Savant to Zaregoto Tsukai");
    expect(v2).toContain("Kubikiri Cycle");

    const v3 = getTitleVariants("Enemy Empire");
    expect(v3).toEqual(["Enemy Empire"]);
  });
});
