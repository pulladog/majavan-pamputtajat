const cheerio = require("cheerio");

const BASE = "https://www.gameresultsonline.com";
const ROOT = "/kiekko-haukat96/salibandyn-harrastesarja/14221";
const URLS = {
  stats: BASE + ROOT + "/statistics",
  groups: BASE + ROOT + "/groups",
  games: BASE + ROOT + "/games"
};

async function load(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; MajavanPamputtajatStats/1.0)" }
  });
  if (!response.ok) throw new Error("GameResultsOnline palautti HTTP " + response.status);
  return cheerio.load(await response.text());
}
function txt($, el) { return $(el).text().replace(/\s+/g, " ").trim(); }
function num(value) { const n = Number(String(value || "").replace(/[^0-9-]/g, "")); return Number.isFinite(n) ? n : 0; }

function parsePlayers($) {
  const table = $("table.statsTable").first();
  const players = [];
  table.find("tr").each((_, tr) => {
    const row = $(tr);
    const name = txt($, row.find(".statPlayer, .statMember").last());
    const team = txt($, row.find(".statTeam").first());
    if (!name || team !== "Majavan Pamputtajat") return;
    players.push({
      name,
      games: num(txt($, row.find(".statGames"))),
      goals: num(txt($, row.find(".statGoals"))),
      assists: num(txt($, row.find(".statAssists"))),
      points: num(txt($, row.find(".statPoints")))
    });
  });
  return players;
}

function parseGroup($) {
  let result = null;
  $(".group").each((_, el) => {
    const group = $(el);
    if (txt($, group.find(".groupHeading")).includes("C-lohko")) {
      const teams = [];
      group.find("table.groupStandings tr").each((i, tr) => {
        if (i === 0) return;
        const row = $(tr);
        const name = txt($, row.find(".playerName"));
        if (!name) return;
        teams.push({
          position: num(txt($, row.find(".playerPosition"))),
          name,
          games: num(txt($, row.find(".playerGames"))),
          wins: num(txt($, row.find(".playerWins"))),
          draws: num(txt($, row.find(".playerDraws"))),
          losses: num(txt($, row.find(".playerLosses"))),
          goals: txt($, row.find(".playerSetPoints")),
          points: num(txt($, row.find(".playerPoints")))
        });
      });
      result = teams;
    }
  });
  if (!result) throw new Error("C-lohkon sarjataulukkoa ei löytynyt");
  return result;
}

function previousText($, el, selector) {
  let node = $(el).prev();
  while (node.length) {
    const found = node.find(selector).first();
    if (found.length) return txt($, found);
    node = node.prev();
  }
  return "";
}
function parseMatches($) {
  const matches = [];
  $(".schedule-game-row").each((_, el) => {
    const row = $(el);
    const players = row.find(".schedule-game-player");
    const home = txt($, players.first());
    const away = txt($, players.last());
    const mobileNames = row.find(".schedule-player-logo span");
    const homeName = home || txt($, mobileNames.first());
    const awayName = away || txt($, mobileNames.last());
    if (homeName !== "Majavan Pamputtajat" && awayName !== "Majavan Pamputtajat") return;

    const resultText = txt($, row.find(".schedule-game-result"));
    const scoreMatch = resultText.match(/(\d+)\s*-\s*(\d+)/);
    const status = txt($, row.find(".schedule-game-status"));
    const group = txt($, row.find(".schedule-game-no-and-group a"));
    const gameNo = txt($, row.find(".schedule-game-no-and-group")).match(/^\d+/);
    const eventHref = row.nextAll().find("a.schedule-game-stats").first().attr("href") || "";
    matches.push({
      date: previousText($, el, ".schedule-date"),
      phase: previousText($, el, ".schedule-phase-header"),
      number: gameNo ? Number(gameNo[0]) : null,
      group,
      time: txt($, row.find(".schedule-game-time")),
      location: txt($, row.find(".schedule-game-location")),
      home: homeName,
      away: awayName,
      homeGoals: scoreMatch ? Number(scoreMatch[1]) : null,
      awayGoals: scoreMatch ? Number(scoreMatch[2]) : null,
      status: status || (scoreMatch ? "Päättynyt" : "Tuleva"),
      eventsUrl: eventHref ? BASE + eventHref : null
    });
  });
  return matches;
}

exports.handler = async function () {
  try {
    const [stats$, groups$, games$] = await Promise.all([
      load(URLS.stats), load(URLS.groups), load(URLS.games)
    ]);
    const players = parsePlayers(stats$);
    const standings = parseGroup(groups$);
    const matches = parseMatches(games$);
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=120"
      },
      body: JSON.stringify({
        updatedAt: new Date().toISOString(),
        players, standings, matches,
        sources: URLS
      })
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify({ error: "Tietojen haku GameResultsOnlinesta epäonnistui.", detail: error.message })
    };
  }
};
