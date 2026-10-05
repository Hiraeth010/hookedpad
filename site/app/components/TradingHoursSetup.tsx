"use client";

import { useEffect, useMemo, useState } from "react";
import { allTimeZones, zoneRule, zoneOffsetMin, fmtOffset, parseHours, formatHours, scheduleFromParams, openAt, nextChange, DAY_NAMES, DEFAULT_HOURS, type DayHours } from "../lib/node/schedule";

// Launcher settings for Trading hours: the time zone (any IANA zone; its daylight-saving rule is
// derived here and stored on-chain) and, per weekday, whether it trades and its open/close times.
// Saved as params.tz and params.hours ("1:540-1020;…", minutes from local midnight).

const toInput = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const fromInput = (v: string) => { const [h, m] = v.split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0; };

export default function TradingHoursSetup({ params, setParam }: { params: Record<string, number | string>; setParam: (k: string, v: number | string) => void }) {
  const [zones] = useState(() => {
    const at = Math.floor(Date.now() / 1000);
    return allTimeZones().map((z) => ({ z, off: zoneOffsetMin(z, at) })).sort((a, b) => a.off - b.off || a.z.localeCompare(b.z));
  });
  // a new form starts in the creator's own zone, Monday to Friday 9am to 5pm
  useEffect(() => {
    if (!params.tz) setParam("tz", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    if (params.hours === undefined) setParam("hours", DEFAULT_HOURS);
  }, [params.tz, params.hours, setParam]);

  const tz = String(params.tz || "UTC");
  const rule = useMemo(() => zoneRule(tz), [tz]);
  const days = parseHours(params.hours ?? DEFAULT_HOURS);
  const setDay = (i: number, d: Partial<DayHours>) => setParam("hours", formatHours(days.map((x, j) => (j === i ? { ...x, ...d } : x))));
  const firstOn = days.find((d) => d.on);

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const t = () => setNow(Math.floor(Date.now() / 1000)); t(); const i = setInterval(t, 30_000); return () => clearInterval(i); }, []);
  const hoursParam = params.hours ?? DEFAULT_HOURS;
  const status = useMemo(() => {
    const { schedule } = scheduleFromParams({ tz, hours: hoursParam });
    if (now === null || !schedule.days) return null;
    const open = openAt(schedule, now), next = nextChange(schedule, now);
    const when = (t: number) => new Date(t * 1000).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
    return `${open ? "Open right now" : "Closed right now"}${next ? ` · ${open ? "closes" : "opens"} ${when(next)} ${tz.replace(/_/g, " ")} time` : ""}`;
  }, [now, tz, hoursParam]);

  return (
    <div className="hours-setup">
      <label className="field" htmlFor="l-tz">Time zone
        <select id="l-tz" className="lselect" value={tz} onChange={(e) => setParam("tz", e.target.value)}>
          {zones.map(({ z, off }) => <option key={z} value={z}>{z.replace(/_/g, " ")} ({fmtOffset(off)} now)</option>)}
        </select>
        <span className="lhelp">
          {rule.exact
            ? `${rule.label}${rule.dstShift ? ". Daylight saving is worked out on-chain, so the hours follow the local clock all year." : "."}`
            : `${tz.replace(/_/g, " ")} moves its clocks on dates that change every year, so the hook can't follow them. It will use ${rule.label} all year, the time there right now.`}
        </span>
      </label>
      <div className="field">Trading days and hours
        <div className="hours-rows">
          {days.map((d, i) => (
            <div key={i} className={`hours-row${d.on ? "" : " is-off"}`}>
              <label className="hours-day"><input type="checkbox" checked={d.on} onChange={(e) => setDay(i, { on: e.target.checked })} />{DAY_NAMES[i]}</label>
              {d.on ? (<>
                <input type="time" aria-label={`${DAY_NAMES[i]} opens`} value={toInput(d.open)} onChange={(e) => setDay(i, { open: fromInput(e.target.value) })} />
                <span className="hours-to">to</span>
                <input type="time" aria-label={`${DAY_NAMES[i]} closes`} value={toInput(d.close)} onChange={(e) => setDay(i, { close: fromInput(e.target.value) })} />
                <span className="hours-note">{d.open === d.close ? "all day" : d.close < d.open ? (d.close === 0 ? "until midnight" : "into the next morning") : ""}</span>
              </>) : <span className="hours-note">closed</span>}
            </div>
          ))}
        </div>
        <span className="lhelp">
          Times are in {tz.replace(/_/g, " ")} time. The same open and close time means open all day; a close earlier than the open runs past midnight into the next morning.{" "}
          {firstOn && days.some((d) => d.on && (d.open !== firstOn.open || d.close !== firstOn.close)) && (
            <button type="button" className="linkish" onClick={() => setParam("hours", formatHours(days.map((d) => (d.on ? { ...d, open: firstOn.open, close: firstOn.close } : d))))}>Use {DAY_NAMES[days.indexOf(firstOn)]}&apos;s hours for every open day</button>
          )}
        </span>
        {status && <span className="lhelp"><b>{status}</b></span>}
      </div>
    </div>
  );
}
