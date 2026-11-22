import copy
import json
import unittest
from datetime import datetime, timezone

import backup_schedule as backups


def utc(value):
 return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def rule(**changes):
 return backups.clean(
  {
   'startDate': '2026-11-02',
   'time': '14:30',
   'frequency': 'weekly',
   'interval': 2,
   'weekdays': [1, 3],
   **changes,
  }
 )


class FakeKube:
 def __init__(self):
  self.schedule = None
  self.backups = []
  self.requested = []

 def call(self, method, path, body=None, patch_type=None):
  self.requested.append((method, path))
  if method == 'GET' and path.endswith('/scheduledbackups'):
   return 200, {'items': [copy.deepcopy(self.schedule)] if self.schedule else []}
  if method == 'GET' and path.endswith('/cluster-daily'):
   return (200, copy.deepcopy(self.schedule)) if self.schedule else (404, {})
  if method == 'POST' and path.endswith('/scheduledbackups'):
   self.schedule = copy.deepcopy(body)
   self.schedule['metadata'].update(uid='schedule-uuid', resourceVersion='1')
   return 201, {}
  if method == 'PATCH' and path.endswith('/cluster-daily'):
   assert (
    body['metadata']['resourceVersion'] == self.schedule['metadata']['resourceVersion']
   )
   self.schedule['metadata']['annotations'].update(body['metadata']['annotations'])
   self.schedule['metadata']['resourceVersion'] = '2'
   self.schedule['spec'].update(body['spec'])
   return 200, {}
  if method == 'GET' and path.endswith('/backups'):
   return 200, {'items': self.backups}
  if method == 'POST' and path.endswith('/backups'):
   self.backups.append({**body, 'status': {'phase': 'completed'}})
   return 201, {}
  raise AssertionError((method, path))


class BackupCalendarTest(unittest.TestCase):
 def test_biweekly_selected_days_use_start_week(self):
  configured = utc('2026-11-02T00:00')
  interval = rule()
  for now, expected in (
   ('2026-11-04T14:33', '2026-11-04T14:30'),
   ('2026-11-09T14:30', None),
   ('2026-11-18T14:30', '2026-11-18T14:30'),
   ('2026-11-18T14:46', None),
  ):
   self.assertEqual(
    backups.due_time(interval, configured, utc(now)),
    utc(expected) if expected else None,
   )

 def test_monthly_nth_and_last_weekday_and_end_conditions(self):
  configured = utc('2026-11-02T00:00')
  interval = rule(
   frequency='monthly',
   interval=1,
   monthMode='weekday',
   weekdays=[1],
   ordinal=2,
   count=2,
  )
  self.assertIsNotNone(backups.due_time(interval, configured, utc('2026-11-09T14:30')))
  self.assertIsNotNone(backups.due_time(interval, configured, utc('2026-12-14T14:30')))
  self.assertIsNone(backups.due_time(interval, configured, utc('2027-01-11T14:30')))
  last = rule(
   frequency='monthly',
   interval=1,
   monthMode='weekday',
   weekdays=[1],
   ordinal=-1,
   endDate='2026-12-01',
  )
  self.assertIsNone(backups.due_time(last, configured, utc('2026-11-23T14:30')))
  self.assertIsNotNone(backups.due_time(last, configured, utc('2026-11-30T14:30')))
  self.assertIsNone(backups.due_time(last, configured, utc('2026-12-28T14:30')))

 def test_month_day_and_leap_day_do_not_roll_over(self):
  configured = utc('2026-11-02T00:00')
  monthly = rule(frequency='monthly', interval=1, monthMode='date', monthDay=31)
  self.assertIsNone(backups.due_time(monthly, configured, utc('2026-11-30T14:30')))
  self.assertIsNotNone(backups.due_time(monthly, configured, utc('2026-12-31T14:30')))
  yearly = rule(frequency='yearly', interval=1, startDate='2028-02-29')
  self.assertIsNone(backups.due_time(yearly, configured, utc('2029-02-28T14:30')))
  self.assertIsNotNone(backups.due_time(yearly, configured, utc('2032-02-29T14:30')))

 def test_saves_updates_and_creates_only_one_backup_per_slot(self):
  kube = FakeKube()
  labels = {'app.kubernetes.io/created-by': backups.CREATOR}
  settings = {'backupSchedule': '0 0 2 * * *', 'backupRecurrence': rule()}
  backups.save(kube, 'coder', 'cluster', settings, labels)
  self.assertTrue(kube.schedule['spec']['suspend'])
  self.assertFalse(kube.schedule['spec']['immediate'])
  configured = json.loads(kube.schedule['metadata']['annotations'][backups.ANNOTATION])[
   'configuredAt'
  ]
  backups.save(kube, 'coder', 'cluster', settings, labels)
  self.assertEqual(
   json.loads(kube.schedule['metadata']['annotations'][backups.ANNOTATION])[
    'configuredAt'
   ],
   configured,
  )
  output = {}
  self.assertTrue(backups.add_to_settings(output, [kube.schedule]))
  self.assertEqual(output['backupRecurrence'], settings['backupRecurrence'])
  # Seed a fixed application time independently of the machine clock.
  kube.schedule['metadata']['annotations'][backups.ANNOTATION] = json.dumps(
   {
    'rule': rule(),
    'configuredAt': '2026-11-02T00:00:00+00:00',
   }
  )
  backups._run_due(kube, 'coder', utc('2026-11-18T14:30'))
  backups._run_due(kube, 'coder', utc('2026-11-18T14:31'))
  self.assertEqual(len(kube.backups), 1)
  self.assertEqual(
   kube.backups[0]['spec'], {'cluster': {'name': 'cluster'}, 'method': 'volumeSnapshot'}
  )
  backups.save(kube, 'coder', 'cluster', {'backupSchedule': '0 0 2 * * *'}, labels)
  self.assertFalse(kube.schedule['spec']['suspend'])
  self.assertIsNone(backups.configured_rule(kube.schedule))

 def test_accepts_only_valid_rules(self):
  for changes in (
   {'interval': 0},
   {'weekdays': []},
   {'startDate': '2026-02-30'},
   {'count': 4, 'endDate': '2026-11-20'},
   {'time': '25:00'},
  ):
   with self.subTest(changes=changes), self.assertRaises(ValueError):
    rule(**changes)


if __name__ == '__main__':
 unittest.main()
