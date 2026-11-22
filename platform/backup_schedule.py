"""Calendar recurrence for CloudNativePG volume-snapshot backups."""

import calendar
import hashlib
import json
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone

ANNOTATION = 'coder.grey-marshall.com/backup-recurrence'
CREATOR = 'coder-ui-updates'
API = '/apis/postgresql.cnpg.io/v1'
WEEKDAY_FORMAT = '%w'
EPOCH = date(1970, 1, 1)
MAX_DATE = date(9998, 12, 31)
LATE_WINDOW = timedelta(minutes=15)


def _integer(value, low, high, label):
 if type(value) is not int or not low <= value <= high:
  raise ValueError('%s must be between %d and %d.' % (label, low, high))
 return value


def _date(value, label):
 if not isinstance(value, str) or not re.fullmatch(
  r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value
 ):
  raise ValueError('%s must be a calendar date.' % label)
 try:
  parsed = date.fromisoformat(value)
 except ValueError:
  raise ValueError('%s must be a calendar date.' % label) from None
 if not EPOCH <= parsed <= MAX_DATE:
  raise ValueError('%s must be between years 1970 and 9998.' % label)
 return parsed


def clean(rule):
 """Validate a rule and keep only fields that determine its occurrences."""
 if not isinstance(rule, dict):
  raise ValueError('Choose a backup recurrence.')
 clock = rule.get('time')
 if not isinstance(clock, str) or not re.fullmatch(
  r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', clock
 ):
  raise ValueError('Backup time must be a valid 24-hour time.')
 start_date = _date(rule.get('startDate'), 'Start date')
 frequency = rule.get('frequency')
 if frequency not in ('daily', 'weekly', 'monthly', 'yearly'):
  raise ValueError('Choose a backup frequency.')
 out = {
  'time': clock,
  'startDate': start_date.isoformat(),
  'frequency': frequency,
  'interval': _integer(rule.get('interval'), 1, 99, 'Repeat interval'),
 }
 if frequency in ('weekly', 'monthly') and (
  frequency == 'weekly' or rule.get('monthMode') == 'weekday'
 ):
  days = rule.get('weekdays')
  if not isinstance(days, list) or not 1 <= len(days) <= 7:
   raise ValueError('Select at least one weekday.')
  out['weekdays'] = sorted({_integer(day, 0, 6, 'Weekday') for day in days})
 if frequency == 'monthly':
  mode = rule.get('monthMode')
  if mode == 'date':
   out['monthDay'] = _integer(rule.get('monthDay'), 1, 31, 'Day of the month')
  elif mode == 'weekday':
   ordinal = rule.get('ordinal')
   if type(ordinal) is not int or ordinal not in (1, 2, 3, 4, 5, -1):
    raise ValueError('Choose the first through fifth or last weekday.')
   out['ordinal'] = ordinal
  else:
   raise ValueError('Choose which day of the month the backup runs.')
  out['monthMode'] = mode
 if rule.get('endDate') is not None:
  end = _date(rule['endDate'], 'End date')
  if end < start_date or rule.get('count') is not None:
   raise ValueError('Choose one end condition and a date on or after the start.')
  out['endDate'] = end.isoformat()
 elif rule.get('count') is not None:
  out['count'] = _integer(rule['count'], 1, 999, 'Number of occurrences')
 return out


def matches(rule, day, anchor):
 if day < anchor:
  return False
 frequency, interval = rule['frequency'], rule['interval']
 elapsed = (day - anchor).days
 if frequency == 'daily':
  return elapsed % interval == 0
 if frequency == 'weekly':
  # The recurrence is anchored to the Monday of the start week.
  week = (elapsed + anchor.weekday()) // 7
  return week % interval == 0 and int(day.strftime(WEEKDAY_FORMAT)) in rule['weekdays']
 if frequency == 'yearly':
  return (day.year - anchor.year) % interval == 0 and (day.month, day.day) == (
   anchor.month,
   anchor.day,
  )
 months = (day.year - anchor.year) * 12 + day.month - anchor.month
 if months % interval:
  return False
 if rule['monthMode'] == 'date':
  return day.day == rule['monthDay']
 if int(day.strftime(WEEKDAY_FORMAT)) not in rule['weekdays']:
  return False
 if rule['ordinal'] == -1:
  return day.day + 7 > calendar.monthrange(day.year, day.month)[1]
 return (day.day - 1) // 7 + 1 == rule['ordinal']


def due_time(rule, configured, now):
 """Return a recent occurrence, allowing short restarts and retries."""
 hour, minute = map(int, rule['time'].split(':'))
 slot = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
 if slot > now:
  slot -= timedelta(days=1)
 if slot <= configured or now - slot > LATE_WINDOW:
  return None
 day = slot.date()
 anchor = date.fromisoformat(rule['startDate'])
 if not matches(rule, day, anchor) or (
  rule.get('endDate') and day > date.fromisoformat(rule['endDate'])
 ):
  return None
 count = rule.get('count')
 if count:
  occurrences = 0
  cursor = anchor
  while cursor <= day:
   occurrences += matches(rule, cursor, anchor)
   if occurrences > count:
    return None
   cursor += timedelta(days=1)
 return slot


def is_managed(resource):
 return (resource.get('metadata', {}).get('labels') or {}).get(
  'app.kubernetes.io/created-by'
 ) == CREATOR


def configured_rule(resource):
 value = (resource.get('metadata', {}).get('annotations') or {}).get(ANNOTATION)
 if not value or not is_managed(resource):
  return None
 try:
  data = json.loads(value)
  return clean(data['rule']), datetime.fromisoformat(data['configuredAt']).astimezone(
   timezone.utc
  )
 except (TypeError, KeyError, ValueError):
  return None


def add_to_settings(settings, scheduled):
 """Use the Coder-managed schedule when available and retain existing cron settings."""
 resource = next((entry for entry in scheduled if is_managed(entry)), None)
 if resource is None:
  if scheduled:
   settings['backupSchedule'] = scheduled[0]['spec']['schedule']
  return False
 settings['backupSchedule'] = resource['spec']['schedule']
 calendar_rule = configured_rule(resource)
 if calendar_rule:
  settings['backupRecurrence'] = calendar_rule[0]
 return True


def save(kube, namespace, cluster, settings, labels):
 """Update the existing managed schedule in place, retaining its backup history."""
 collection = f'{API}/namespaces/{namespace}/scheduledbackups'
 name = cluster + '-daily'
 status, current = kube.call('GET', f'{collection}/{name}')
 if status not in (200, 404):
  raise RuntimeError('Could not read ScheduledBackup (HTTP %s).' % status)
 if status == 200 and (
  not is_managed(current)
  or current['spec']['cluster']['name'] != cluster
  or current['spec'].get('method') != 'volumeSnapshot'
 ):
  raise ValueError('This backup schedule is managed outside Coder.')
 rule = settings.get('backupRecurrence')
 spec = {
  'schedule': settings['backupSchedule'],
  'suspend': bool(rule),
  'immediate': False,
 }
 metadata = {'annotations': {ANNOTATION: None}}
 if rule:
  hour, minute = map(int, rule['time'].split(':'))
  spec['schedule'] = f'0 {minute} {hour} * * *'
  old = configured_rule(current) if status == 200 else None
  configured = old[1] if old and old[0] == rule else datetime.now(timezone.utc)
  metadata['annotations'][ANNOTATION] = json.dumps(
   {'rule': rule, 'configuredAt': configured.isoformat()}
  )
 if status == 200:
  metadata['resourceVersion'] = current['metadata']['resourceVersion']
  code, _ = kube.call(
   'PATCH',
   f'{collection}/{name}',
   {'metadata': metadata, 'spec': spec},
   'application/merge-patch+json',
  )
 else:
  if not rule:
   metadata.pop('annotations')
  metadata.update(name=name, namespace=namespace, labels=labels)
  spec.update(
   backupOwnerReference='self', cluster={'name': cluster}, method='volumeSnapshot'
  )
  code, _ = kube.call(
   'POST',
   collection,
   {
    'apiVersion': 'postgresql.cnpg.io/v1',
    'kind': 'ScheduledBackup',
    'metadata': metadata,
    'spec': spec,
   },
  )
 if code not in (200, 201):
  raise RuntimeError('Saving ScheduledBackup failed (HTTP %s).' % code)


def _run_due(kube, namespace, now):
 prefix = f'{API}/namespaces/{namespace}'
 status, schedules = kube.call('GET', f'{prefix}/scheduledbackups')
 if status in (403, 404):
  return
 if status != 200:
  raise RuntimeError('Could not list backup schedules (HTTP %s).' % status)
 for schedule in schedules.get('items', []):
  stored = configured_rule(schedule)
  spec = schedule.get('spec', {})
  if (
   not stored
   or spec.get('suspend') is not True
   or spec.get('method') != 'volumeSnapshot'
  ):
   continue
  slot = due_time(*stored, now)
  if slot is None:
   continue
  metadata = schedule['metadata']
  target = spec['cluster']['name']
  code, existing = kube.call('GET', f'{prefix}/backups')
  if code != 200:
   continue
  if any(
   backup.get('spec', {}).get('cluster', {}).get('name') == target
   and backup.get('status', {}).get('phase') not in ('completed', 'failed')
   for backup in existing.get('items', [])
  ):
   continue
  digest = hashlib.sha256(metadata['uid'].encode()).hexdigest()[:16]
  name = f'coder-calendar-{digest}-{slot:%Y%m%d%H%M}'
  if any(backup['metadata']['name'] == name for backup in existing.get('items', [])):
   continue
  code, current = kube.call('GET', f'{prefix}/scheduledbackups/{metadata["name"]}')
  if (
   code != 200 or current['metadata']['resourceVersion'] != metadata['resourceVersion']
  ):
   continue
  code, _ = kube.call(
   'POST',
   f'{prefix}/backups',
   {
    'apiVersion': 'postgresql.cnpg.io/v1',
    'kind': 'Backup',
    'metadata': {
     'name': name,
     'namespace': namespace,
     'ownerReferences': [
      {
       'apiVersion': schedule['apiVersion'],
       'kind': 'ScheduledBackup',
       'name': metadata['name'],
       'uid': metadata['uid'],
      }
     ],
    },
    'spec': {'cluster': {'name': target}, 'method': 'volumeSnapshot'},
   },
  )
  if code not in (200, 201, 409):
   raise RuntimeError('Creating calendar Backup failed (HTTP %s).' % code)


def start(kube, namespace, log):
 if not kube.ok:
  return

 def run():
  while True:
   try:
    _run_due(kube, namespace, datetime.now(timezone.utc))
   except Exception as exc:  # noqa: BLE001 - retry on the next tick
    log(event='backup-calendar-failed', error=str(exc)[:200])
   time.sleep(30)

 threading.Thread(target=run, name='backup-calendar', daemon=True).start()
