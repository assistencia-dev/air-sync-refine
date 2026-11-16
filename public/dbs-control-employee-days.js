(function exposeDbsEmployeeSchedule(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DbsEmployeeSchedule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createDbsEmployeeSchedule() {
  "use strict";

  function localIsoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function isValidIsoDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return date.getFullYear() === Number(match[1])
      && date.getMonth() + 1 === Number(match[2])
      && date.getDate() === Number(match[3]);
  }

  function normalizeOrderDate(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return isValidIsoDate(raw) ? raw : "";
    }

    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) {
      const iso = br[3] + "-" + br[2] + "-" + br[1];
      return isValidIsoDate(iso) ? iso : "";
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : localIsoDate(parsed);
  }

  function addDays(iso, amount) {
    const parts = iso.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2] + amount, 12);
    return localIsoDate(date);
  }

  function displayDate(iso, today, tomorrow, yesterday) {
    if (!iso) return "Sem data definida";
    const parts = iso.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2], 12);
    const options = { weekday: "long", day: "2-digit", month: "long" };
    if (parts[0] !== Number(today.slice(0, 4))) options.year = "numeric";
    const label = new Intl.DateTimeFormat("pt-BR", options).format(date);
    const capitalized = label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1);

    if (iso === today) return "Hoje · " + capitalized;
    if (iso === tomorrow) return "Amanhã · " + capitalized;
    if (iso === yesterday) return "Ontem · " + capitalized;
    return capitalized;
  }

  function groupOrdersByDay(orders, tab, now) {
    const referenceDate = now instanceof Date ? now : new Date();
    const today = localIsoDate(referenceDate);
    if (!today) return [];
    const tomorrow = addDays(today, 1);
    const yesterday = addDays(today, -1);
    const completedTab = tab === "concluidas";
    const groups = new Map();

    (Array.isArray(orders) ? orders : []).forEach((order) => {
      const date = normalizeOrderDate(order && order.data);
      const key = date || "sem-data";
      if (!groups.has(key)) {
        const kind = !date ? "undated"
          : date < today ? "past"
            : date === today ? "today" : "future";
        groups.set(key, {
          key,
          date,
          kind,
          title: displayDate(date, today, tomorrow, yesterday),
          caption: !date ? "OS sem data cadastrada"
            : completedTab ? "Histórico de atendimentos"
              : kind === "past" ? "Data anterior"
                : kind === "today" ? "Agenda de hoje"
                  : kind === "future" && date === tomorrow ? "Próximo dia"
                    : "Programação",
          orders: [],
        });
      }
      groups.get(key).orders.push(order);
    });

    return Array.from(groups.values()).sort((a, b) => {
      if (a.kind === "undated") return b.kind === "undated" ? 0 : 1;
      if (b.kind === "undated") return -1;
      if (completedTab) return b.date.localeCompare(a.date);
      const rank = (group) => group.kind === "past" ? 0 : group.kind === "today" ? 1 : 2;
      const rankDifference = rank(a) - rank(b);
      if (rankDifference) return rankDifference;
      return a.kind === "past"
        ? b.date.localeCompare(a.date)
        : a.date.localeCompare(b.date);
    });
  }

  return { normalizeOrderDate, groupOrdersByDay };
});
