(function (root) {
  "use strict";

  var TIME_ZONE = "America/Sao_Paulo";

  function parseDateKey(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? "" : value));
    if (!match) return null;
    var year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    var stamp = Date.UTC(year, month - 1, day);
    var checked = new Date(stamp);
    if (checked.getUTCFullYear() !== year || checked.getUTCMonth() + 1 !== month || checked.getUTCDate() !== day) return null;
    return [year, month, day];
  }

  function normalize(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return null;
    var iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|T|\s)/);
    if (iso) return parseDateKey(iso[1]) ? iso[1] : null;
    var br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    if (!br) return null;
    var key = br[3] + "-" + br[2] + "-" + br[1];
    return parseDateKey(key) ? key : null;
  }

  function today(date) {
    var value = date instanceof Date ? date : new Date();
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(value);
    var part = function (type) {
      var found = parts.find(function (item) { return item.type === type; });
      return found ? found.value : "";
    };
    return part("year") + "-" + part("month") + "-" + part("day");
  }

  function addDays(dateKey, offset) {
    var parsed = parseDateKey(dateKey);
    if (!parsed || !Number.isInteger(offset)) throw new Error("Data ou deslocamento inválido.");
    return new Date(Date.UTC(parsed[0], parsed[1] - 1, parsed[2] + offset)).toISOString().slice(0, 10);
  }

  function differenceInDays(from, to) {
    var start = parseDateKey(normalize(from));
    var end = parseDateKey(normalize(to));
    if (!start || !end) return NaN;
    return Math.round((
      Date.UTC(end[0], end[1] - 1, end[2]) -
      Date.UTC(start[0], start[1] - 1, start[2])
    ) / 86400000);
  }

  function monthRange(baseDateKey, monthOffset) {
    var parsed = parseDateKey(normalize(baseDateKey));
    if (!parsed) throw new Error("Data-base inválida.");
    var offset = Number.isInteger(monthOffset) ? monthOffset : 0;
    var first = new Date(Date.UTC(parsed[0], parsed[1] - 1 + offset, 1));
    var last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    return {
      start: first.toISOString().slice(0, 10),
      end: last.toISOString().slice(0, 10)
    };
  }

  function matchesRange(value, start, end) {
    var date = normalize(value);
    if (!date) return false;
    var lower = start ? normalize(start) : "0001-01-01";
    var upper = end ? normalize(end) : "9999-12-31";
    return Boolean(lower && upper && date >= lower && date <= upper);
  }

  root.DbsTreasuryDates = Object.freeze({
    timeZone: TIME_ZONE,
    normalize: normalize,
    today: today,
    addDays: addDays,
    differenceInDays: differenceInDays,
    monthRange: monthRange,
    matchesRange: matchesRange
  });
})(window);
