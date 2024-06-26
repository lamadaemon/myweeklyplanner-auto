# MyWeeklyPlanner-Auto

[![996.icu](https://img.shields.io/badge/link-996.icu-red.svg)](https://996.icu)
[![LICENSE](https://img.shields.io/badge/license-Anti%20996-blue.svg)](https://github.com/996icu/996.ICU/blob/master/LICENSE)
[![npm](https://img.shields.io/npm/v/myweeklyplanner-auto)](https://www.npmjs.com/package/myweeklyplanner-auto)

A simple script used to automatically setup your plans in MyWeeklyPlanner

## Usage

First, install via `npm -g myweeklyplanner-auto`

You'll need a profile name and then use the command above to generate a config.

```
myweeklyplanner-auto <profileName> --genConfig
```

You'll need to fill in these fields: `username` `password` `botToken(If you need to notify you in tg)` `target(If you need to notify you in tg)` `schedule` `baseURL`

The field schedule is an array with the size of 7. The first entry represents Sunday then the Monday and vice-versa.
Here is an example entry. You have to enter either room or the teacher's name to let the script find their staffID.

In the plan field, you have to enter your plan for that day.

```
{
     "selectionCandidate": {
         "room": "222B",
         "teacher": ""
     },
     "plan": "Career life education"
}
```

Last, setup this script on your server with a crontab task:

```
0 0 */14 * 0 myweeklyplanner-auto <profile> [--tg] >/dev/null 2>&1
```

If you want to see all the teachers you may use the command: (Need a profile!)

```
myweeklyplanner-auto <profileName> --listTeachers
```

## Changelog

- 1.0.3:
  - Fix overriding exist entries
  - Improve performance

## Future plan

- [ ] Use commander to manage cli.
- [ ] Make telegram notify feature use editMessage instead of sending new messages.
