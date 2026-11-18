# Database backups and restore

There is one production database for the platform, and losing it would mean losing bookings, invoices and the badge events that bill the customers. Backups are not a backup until a restore has been tested, so this page covers both, and the restore test is on the calendar.

## What is backed up

The production database: a full snapshot every night at 02:00 Paris time, kept for 35 days, and the write-ahead log shipped continuously, so the database can be restored to any second in the last 35 days. Monthly snapshots are kept for 13 months, the same as the badge events, in the second French region. The telemetry store is backed up weekly only; it can be rebuilt from the hubs, which keep 30 days of readings.

## Where

The nightly snapshots are in the primary region; a copy goes to the second region within an hour. Both are encrypted with a key the database provider does not hold. Nothing leaves the EU.

## Restore to a point in time

Open the database console, choose the production instance, choose "restore to a point in time" and the second you want, and restore into a new instance named with the date. Never restore over the running production instance. The new instance takes between twenty and forty minutes to be ready. Then run the verification script from the operations repository against it: it checks the row counts of the twelve largest tables against the nightly report and the last badge event's timestamp.

## Switching over

If the restored instance is the one to keep, the switch is a change of the database address in the secrets manager followed by a rolling restart of the three services, in this order: fleet service, booking API, web app. Hubs reconnect on their own. The old instance is kept, stopped, for seven days.

## The restore test

The first Wednesday of every month, the on-call secondary restores last night's snapshot into a fresh instance, runs the verification script, writes the result and the time it took in the operations channel, and deletes the instance. A test that takes more than an hour, or that fails, is a Sev 3 incident with a review. The last twelve results are in the operations wiki.

## Exports for customers

A customer can ask for an export of their data. Exports come from a restored copy, never from production, and are produced by the data team as CSV files per table, encrypted, with a password sent by another channel. The export job is logged with who asked, who ran it and what it contained.

## What is not backed up

Anything on a laptop. Anything in a chat channel. Files in the shared drive are versioned by the provider for 30 days but not backed up by Oriel; a document that matters belongs in the wiki or the repository.
