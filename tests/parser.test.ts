/**
 * lib/parser.test.ts
 * Unit tests for the hardened filename parser (LIB_FIX_PLAN.md Phase 2).
 * Run: bun test lib/parser.test.ts
 */
import { describe, expect, test } from "bun:test";
import { parseMediaFilename, extractBrackets } from "../lib/parser";

describe("parseMediaFilename — movies", () => {
  test("Enemy 2013 (the reported bug)", () => {
    const r = parseMediaFilename("Enemy.2013.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-RARBG.mkv");
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Enemy");
    expect(r.year).toBe("2013");
  });

  test("A Silent Voice 2016 with Ryuuga release group tag (the reported bug)", () => {
    const r = parseMediaFilename(
      "A Silent Voice 2016 1080p Bluray REMUX Dual-Audio DTS-HD MA 5.1 - Ryuuga.mkv"
    );
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("A Silent Voice");
    expect(r.year).toBe("2016");
  });

  test("Stalker 1979 with DV/HDR tags", () => {
    const r = parseMediaFilename("Stalker.1979.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.DTS-HD.MA.2.0-SpaceHD13.mkv");
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Stalker");
    expect(r.year).toBe("1979");
  });

  test("title containing a year-like number keeps last year as release year", () => {
    const r = parseMediaFilename("Blade.Runner.2049.2017.2160p.UHD.BluRay.mkv");
    expect(r.title).toBe("Blade Runner 2049");
    expect(r.year).toBe("2017");
  });

  test("year at start of title is not cut (2001 A Space Odyssey)", () => {
    const r = parseMediaFilename("2001.A.Space.Odyssey.1968.1080p.BluRay.mkv");
    expect(r.title).toBe("2001 A Space Odyssey");
    expect(r.year).toBe("1968");
  });

  test("1917 (title is the year)", () => {
    const r = parseMediaFilename("1917.2019.1080p.BluRay.mkv");
    expect(r.title).toBe("1917");
    expect(r.year).toBe("2019");
  });

  test("blacklist tokens before the year are stripped (Alien Director Cut EXTENDED)", () => {
    const r = parseMediaFilename("Alien.Director.Cut.EXTENDED.1979.REMUX.mkv");
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Alien");
    expect(r.year).toBe("1979");
  });

  test("Enemy of the State is not mangled", () => {
    const r = parseMediaFilename("Enemy.of.the.State.1998.1080p.BluRay.mkv");
    expect(r.title).toBe("Enemy of the State");
    expect(r.year).toBe("1998");
  });

  test("region-like token NOT stripped when it is the whole title (Us, 2019)", () => {
    const r = parseMediaFilename("Us.2019.1080p.BluRay.mkv");
    expect(r.title).toBe("Us");
    expect(r.year).toBe("2019");
  });

  test("Star Wars Episode VIII with multi-language 3-letter codes after year", () => {
    const r = parseMediaFilename(
      "Star.Wars.Episode.VIII.The.Last.Jedi.2017.Eng.Fre.Ger.Ita.Spa.2160p.BluRay.Remux.DV.HDR.HEVC.Atmos-SGF.mkv"
    );
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Star Wars Episode VIII The Last Jedi");
    expect(r.year).toBe("2017");
  });

  test("Star Wars Episode IV with multi-language codes", () => {
    const r = parseMediaFilename(
      "Star.Wars.Episode.IV.A.New.Hope.1977.Eng.Fre.Ger.Ita.Spa.Jpn.2160p.BluRay.Hybrid.Remux.DV.HDR.HEVC.Atmos-SGF.mkv"
    );
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Star Wars Episode IV A New Hope");
    expect(r.year).toBe("1977");
  });

  test.skip("Blade Runner 2049 Open Matte (yearless, quality marker fallback)", () => {
    const r = parseMediaFilename(
      "Blade.Runner.2049.Open.Matte.INTERNAL.HDR-X.DoVi.Ver.1.0.4.TrueHD.Atmos.7.1-TEKNO3D.mkv"
    );
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Blade Runner 2049");
  });

  test("Bakemono no Ko 2015", () => {
    const r = parseMediaFilename("Bakemono.no.Ko.2015.2160p.WEB-DL.DD5.1.HDR.x265-tG1R0.mkv");
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Bakemono no Ko");
    expect(r.year).toBe("2015");
  });

  test("language-word titles are preserved (The English Patient, The French Dispatch, The Italian Job)", () => {
    const english = parseMediaFilename("The.English.Patient.1996.1080p.BluRay.mkv");
    expect(english.title).toBe("The English Patient");
    expect(english.year).toBe("1996");

    const french = parseMediaFilename("The.French.Dispatch.2021.1080p.BluRay.mkv");
    expect(french.title).toBe("The French Dispatch");
    expect(french.year).toBe("2021");

    const italian = parseMediaFilename("The.Italian.Job.2003.1080p.BluRay.mkv");
    expect(italian.title).toBe("The Italian Job");
    expect(italian.year).toBe("2003");
  });

  test("El-prefixed titles are not broken by language blacklist (El Topo, El Camino)", () => {
    const topo = parseMediaFilename("El.Topo.1970.1080p.BluRay.mkv");
    expect(topo.title).toBe("El Topo");
    expect(topo.year).toBe("1970");

    const camino = parseMediaFilename("El.Camino.A.Breaking.Bad.Movie.2019.1080p.mkv");
    expect(camino.title).toBe("El Camino A Breaking Bad Movie");
    expect(camino.year).toBe("2019");
  });
});

describe("parseMediaFilename — brackets", () => {
  test("bare year bracket is kept as the year", () => {
    const r = parseMediaFilename("Some.Movie.(2021).[Group].mkv");
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Some Movie");
    expect(r.year).toBe("2021");
  });

  test("non-year bracket junk is discarded", () => {
    const r = parseMediaFilename("Some.Movie.2019.[Cunnysseur].mkv");
    expect(r.title).toBe("Some Movie");
    expect(r.year).toBe("2019");
  });

  test("quality tag inside a bracket is not treated as a year", () => {
    const r = parseMediaFilename("Some.Movie.(1080p).mkv");
    expect(r.mediaType).toBe("other"); // no year anywhere
    expect(r.year).toBeUndefined();
  });

  test("Blame! (2017) with bracket year, codec tags, and trailing v2 (the reported bug)", () => {
    const r = parseMediaFilename("Blame! (2017) [BD 1080p Hi10P AAC dual-audio][kuchikirukia]v2.mkv");
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Blame!");
    expect(r.year).toBe("2017");
  });

  test("bracket year followed by version tag v2 (Mysterious Skin)", () => {
    const r = parseMediaFilename("Mysterious Skin (2004) v2 (1080p BluRay x265 afm72).mkv");
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Mysterious Skin");
    expect(r.year).toBe("2004");
  });

  test("bracket year followed by distributor tag (Kwaidan Criterion)", () => {
    const r = parseMediaFilename("Kwaidan (1964) Criterion (1080p BluRay x265 10bit Tigole).mkv");
    expect(r.mediaType).toBe("movie");
    expect(r.title).toBe("Kwaidan");
    expect(r.year).toBe("1964");
  });

  test("titles with single-letter X are preserved (X-Men, Malcolm X, Fast X)", () => {
    const xmen = parseMediaFilename("X-Men 2000 4K.mkv");
    expect(xmen.title).toBe("X Men");
    expect(xmen.year).toBe("2000");

    const malcolm = parseMediaFilename("Malcolm.X.1992.1080p.mkv");
    expect(malcolm.title).toBe("Malcolm X");
    expect(malcolm.year).toBe("1992");

    const fastx = parseMediaFilename("Fast.X.2023.1080p.mkv");
    expect(fastx.title).toBe("Fast X");
    expect(fastx.year).toBe("2023");
  });
});

describe("parseMediaFilename — tv", () => {
  test("Sopranos episode with episode title after SxxEyy", () => {
    const r = parseMediaFilename("The.Sopranos.S01E05.College.1080p.DTS-HD.MA.5.1.AVC.REMUX-FraMeSToR.mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("The Sopranos");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([5]);
  });

  test("region marker extracted as a hint (The Office US)", () => {
    const r = parseMediaFilename("The.Office.US.S02E01.720p.mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("The Office");
    expect(r.region).toBe("us");
    expect(r.season).toBe(2);
  });

  test("Peaky Blinders UK", () => {
    const r = parseMediaFilename("Peaky.Blinders.UK.S03E01.1080p.BluRay.mkv");
    expect(r.title).toBe("Peaky Blinders");
    expect(r.region).toBe("uk");
  });

  test("This Is Us: region token is extracted as a hint, sync's region-fallback recovers", () => {
    const r = parseMediaFilename("This.Is.Us.S01E01.1080p.mkv");
    // "us" is a region token and gets extracted; the query becomes "This Is" which will
    // no-match, and lib/tmdb retries with "This Is US" (region appended) → exact match.
    expect(r.title).toBe("This Is");
    expect(r.region).toBe("us");
  });

  test("season-only pack (Chernobyl S01)", () => {
    const r = parseMediaFilename("Chernobyl.S01.2160p.Netflix.WEB-DL.DDP5.1.Atmos.HDR.HEVC.mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("Chernobyl");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([]);
  });

  test("multi-episode file S01E01-E02", () => {
    const r = parseMediaFilename("Show.S01E01-E02.1080p.mkv");
    expect(r.episodes).toEqual([1, 2]);
  });

  test("x-format episode", () => {
    const r = parseMediaFilename("Show.1x05.720p.mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([5]);
  });

  test("word form: Rome (2005) Season 1 Episode 01 (the reported bug)", () => {
    const r = parseMediaFilename("Rome (2005) Season 1 Episode 01 2160p H.264 (moviesbyrizzo conversion).mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("Rome"); // H.264 must not leak as "264"
    expect(r.year).toBe("2005");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([1]);
  });

  test("word form: dot separators", () => {
    const r = parseMediaFilename("Show.Season.03.Episode.6.mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("Show");
    expect(r.season).toBe(3);
    expect(r.episodes).toEqual([6]);
  });

  test("word form: season + E marker", () => {
    const r = parseMediaFilename("Show Season 1 E04.mkv");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([4]);
    expect(r.title).toBe("Show");
  });

  test("word form: numeric season + word episode (S8 Episode 3)", () => {
    const r = parseMediaFilename("Show S8 Episode 3.mkv");
    expect(r.season).toBe(8);
    expect(r.episodes).toEqual([3]);
  });

  test("word form: plain Season X Episode Y", () => {
    const r = parseMediaFilename("Show Season 1 Episode 12.mkv");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([12]);
  });

  test("word form: multiple episode markers", () => {
    const r = parseMediaFilename("Show Season 1 Episode 1 Episode 2.mkv");
    expect(r.episodes).toEqual([1, 2]);
  });

  test("word form: Ep abbreviation", () => {
    const r = parseMediaFilename("Show Season 1 Ep 05.mkv");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([5]);
  });

  test("word form: reversed order (Episode 4 Season 2)", () => {
    const r = parseMediaFilename("Show Episode 4 Season 2.mkv");
    expect(r.season).toBe(2);
    expect(r.episodes).toEqual([4]);
    expect(r.title).toBe("Show");
  });

  test("word form: episode range (Season 2 Episode 03-04)", () => {
    const r = parseMediaFilename("Show Season 2 Episode 03-04.mkv");
    expect(r.season).toBe(2);
    expect(r.episodes).toEqual([3, 4]);
  });

  test("word form: episode-only word form", () => {
    const r = parseMediaFilename("Show Episode 4.mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([4]);
  });

  test("H.264 codec phrase does not leak into titles", () => {
    const r = parseMediaFilename("Meet.the.Parents.2004.H.264.1080p.mkv");
    expect(r.title).toBe("Meet the Parents");
  });

  test("bare 300 in title is not blacklisted as codec", () => {
    const r = parseMediaFilename("Movie 300 2006.mkv");
    expect(r.title).toBe("Movie 300");
    expect(r.year).toBe("2006");
  });

  test("The Kubikiri Cycle with Cunnysseur group tag (the reported bug)", () => {
    const r = parseMediaFilename(
      "[Cunnysseur] The Kubikiri Cycle - S01E01 [BD Remux 1080p AVC FLAC] [2B33EF24].mkv"
    );
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("The Kubikiri Cycle");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([1]);
  });

  test("anime standalone dash episode format (- 01)", () => {
    const r = parseMediaFilename("[SubsPlease] Sousou no Frieren - 01 (1080p) [ABCD1234].mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("Sousou no Frieren");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([1]);
  });

  test("anime high episode number (One Piece - 1085)", () => {
    const r = parseMediaFilename("[Erai-raws] One Piece - 1085 [1080p].mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("One Piece");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([1085]);
  });

  test("anime episode range (Attack on Titan - 05-06)", () => {
    const r = parseMediaFilename("[HorribleSubs] Attack on Titan - 05-06 [720p].mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("Attack on Titan");
    expect(r.season).toBe(1);
    expect(r.episodes).toEqual([5, 6]);
  });

  test("ordinal season with anime dash episode (2nd Season - 01)", () => {
    const r = parseMediaFilename("[Erai-raws] Jujutsu Kaisen 2nd Season - 01 [1080p].mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("Jujutsu Kaisen");
    expect(r.season).toBe(2);
    expect(r.episodes).toEqual([1]);
  });

  test("word season with anime dash episode (Season 3 - 01)", () => {
    const r = parseMediaFilename("Attack on Titan Season 3 - 01.mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("Attack on Titan");
    expect(r.season).toBe(3);
    expect(r.episodes).toEqual([1]);
  });

  test("S-prefix season with anime dash episode (S2 - 01)", () => {
    const r = parseMediaFilename("Show Name S2 - 01.mkv");
    expect(r.mediaType).toBe("tv");
    expect(r.title).toBe("Show Name");
    expect(r.season).toBe(2);
    expect(r.episodes).toEqual([1]);
  });
});

describe("extractBrackets", () => {
  test("keeps bare 4-digit year, drops the rest", () => {
    const r = extractBrackets("Movie (2021) [Cunnysseur] {subs}");
    expect(r.bracketYear).toBe("2021");
    expect(r.cleaned).not.toContain("Cunnysseur");
  });

  test("non-year 4-digit quality numbers are not years", () => {
    const r = extractBrackets("Movie (1080p)");
    expect(r.bracketYear).toBeUndefined();
  });
});
