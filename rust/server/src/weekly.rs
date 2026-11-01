//! Coder's five-field weekly cron syntax, evaluated in an embedded IANA zone.
use crate::{Error, Result};
use chrono::{DateTime, Datelike, Duration, Timelike, Utc};
use chrono_tz::Tz;

#[derive(Debug)]
pub(crate) struct Weekly {
    zone: Tz,
    minutes: u64,
    hours: u64,
    days: u64,
    pub canonical: String,
}

fn field(raw: &str, max: u32, weekdays: bool) -> Result<u64> {
    let number = |value: &str| -> Result<u32> {
        let value = if weekdays {
            match value.to_ascii_uppercase().as_str() {
                "SUN" => 0,
                "MON" => 1,
                "TUE" => 2,
                "WED" => 3,
                "THU" => 4,
                "FRI" => 5,
                "SAT" => 6,
                _ => value
                    .parse()
                    .map_err(|_| Error::bad("Invalid cron field."))?,
            }
        } else {
            value
                .parse()
                .map_err(|_| Error::bad("Invalid cron field."))?
        };
        if value > max {
            return Err(Error::bad("Cron value is out of range."));
        }
        Ok(value)
    };
    let mut bits = 0;
    for part in raw.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((range, step)) => (
                range,
                step.parse::<u32>()
                    .map_err(|_| Error::bad("Invalid cron step."))?,
            ),
            None => (part, 1),
        };
        if step == 0 {
            return Err(Error::bad("Cron step is out of range."));
        }
        let (first, last) = if matches!(range, "*" | "?") {
            (0, max)
        } else if let Some((first, last)) = range.split_once('-') {
            (number(first)?, number(last)?)
        } else {
            let first = number(range)?;
            (first, if part.contains('/') { max } else { first })
        };
        if first > last {
            return Err(Error::bad("Cron range must be ascending."));
        }
        for n in (first..=last).step_by(step as usize) {
            bits |= 1 << n;
        }
    }
    if bits == 0 {
        return Err(Error::bad("Empty cron field."));
    }
    Ok(bits)
}

impl Weekly {
    pub fn parse(raw: &str) -> Result<Self> {
        if raw.len() > 256 {
            return Err(Error::bad("Schedule is too long."));
        }
        let mut fields: Vec<_> = raw.split_whitespace().collect();
        let zone: Tz = if fields.first().is_some_and(|v| v.starts_with("CRON_TZ=")) {
            fields
                .remove(0)
                .trim_start_matches("CRON_TZ=")
                .parse()
                .map_err(|_| Error::bad("Unknown IANA time zone."))?
        } else {
            chrono_tz::UTC
        };
        if fields.len() != 5 || fields[2] != "*" || fields[3] != "*" {
            return Err(Error::bad("Use CRON_TZ=Area/City minute hour * * weekday."));
        }
        Ok(Self {
            zone,
            minutes: field(fields[0], 59, false)?,
            hours: field(fields[1], 23, false)?,
            days: field(fields[4], 6, true)?,
            canonical: format!("CRON_TZ={zone} {}", fields.join(" ")),
        })
    }

    /// UTC iteration handles both sides of a repeated local hour and skips
    /// nonexistent local times, without treating a DST day as 24 local hours.
    pub fn next(&self, after: DateTime<Utc>) -> Result<DateTime<Utc>> {
        let mut next = after
            .with_second(0)
            .and_then(|v| v.with_nanosecond(0))
            .ok_or_else(|| Error::bad("Invalid schedule time."))?;
        for _ in 0..(16 * 24 * 60) {
            next = next
                .checked_add_signed(Duration::minutes(1))
                .ok_or_else(|| Error::bad("Schedule time overflow."))?;
            let local = next.with_timezone(&self.zone);
            if self.minutes & (1 << local.minute()) != 0
                && self.hours & (1 << local.hour()) != 0
                && self.days & (1 << local.weekday().num_days_from_sunday()) != 0
            {
                return Ok(next);
            }
        }
        Err(Error::bad(
            "No schedule occurrence in the next sixteen days.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn time(value: &str) -> DateTime<Utc> {
        value.parse().unwrap()
    }
    #[test]
    fn weekly_ranges_steps_and_strict_next() {
        let schedule = Weekly::parse("*/15 9-17 * * MON-FRI").unwrap();
        assert_eq!(
            Weekly::parse("*/90 9 * * MON")
                .unwrap()
                .next(time("2026-11-02T08:59:00Z"))
                .unwrap(),
            time("2026-11-02T09:00:00Z")
        );
        assert_eq!(
            schedule.next(time("2026-11-02T09:00:00Z")).unwrap(),
            time("2026-11-02T09:15:00Z")
        );
        assert_eq!(
            schedule.next(time("2026-11-06T17:59:00Z")).unwrap(),
            time("2026-11-09T09:00:00Z")
        );
        for raw in [
            "@daily",
            "0 9 1 * *",
            "60 9 * * *",
            "*/0 9 * * *",
            "0 24 * * *",
            "0 9 * * 7",
            "CRON_TZ=Local 0 9 * * *",
        ] {
            assert!(Weekly::parse(raw).is_err(), "{raw}");
        }
    }
    #[test]
    fn daylight_saving_gaps_and_repeated_hours() {
        let gap = Weekly::parse("CRON_TZ=America/New_York 30 2 * * *").unwrap();
        assert_eq!(
            gap.next(time("2026-03-08T06:59:00Z")).unwrap(),
            time("2026-03-09T06:30:00Z")
        );
        let repeated = Weekly::parse("CRON_TZ=America/New_York 30 1 * * *").unwrap();
        let first = repeated.next(time("2026-11-01T05:00:00Z")).unwrap();
        assert_eq!(first, time("2026-11-01T05:30:00Z"));
        assert_eq!(repeated.next(first).unwrap(), time("2026-11-01T06:30:00Z"));
        let half = Weekly::parse("CRON_TZ=Asia/Kolkata 0 9 * * *").unwrap();
        assert_eq!(
            half.next(time("2026-11-01T00:00:00Z")).unwrap(),
            time("2026-11-01T03:30:00Z")
        );
    }
}
