# Data retention and privacy

Oriel is a data processor for its customers, the delivery companies whose couriers use the hubs, and a data controller for its own employees and for the couriers who sign up directly. This page says what is kept, for how long, and why. The legal basis for each category is in the register of processing kept by the privacy lead.

## Courier badge data

A badge event (badge id, hub id, slot, timestamp) is needed to bill the customer and to open the slot. It is kept in full for 13 months, which covers one year of invoices plus the dispute window, then aggregated to hourly counts per hub and deleted. A courier's name and phone number come from the customer, are used only to send the one-time badge code, and are deleted 30 days after the badge is deactivated.

## Hub telemetry

Battery voltage, temperature, charger state and door sensor readings are kept at full resolution for 90 days, at one-minute resolution for two years, and at hourly resolution forever, because the long series is how the firmware team finds slow failures. Telemetry has no personal data in it; the slot-to-badge link is in the badge events, not here.

## Video

Hubs have a camera on the door for safety. Footage is kept for 7 days on the hub and never leaves it unless an incident is logged, in which case the clip for that incident is copied to the incident record and kept for one year. Footage is viewed only by the two people named in the incident procedure.

## Customer accounts

Account, contract and invoice data are kept for the contract plus 10 years, as French accounting law requires. Support conversations are kept for three years. Marketing consent is recorded with the date and the wording shown, and is honoured within 48 hours of being withdrawn.

## Employees

The personnel file is kept for five years after the person leaves; payroll records for ten. Applications from people who were not hired are deleted after two years unless they asked to be kept on file. Badge access logs for the offices are kept for three months.

## Requests from people

Anyone can ask what Oriel holds about them, ask for it to be corrected or deleted, or object to a use. Requests go to the privacy mailbox and are answered within one month, in writing, by the privacy lead. A request from a courier goes through the customer who employs them unless the courier signed up directly.

## Where data lives

Everything is hosted in the EU, with the database in France and backups in a second French region. No personal data is sent to a provider outside the EU. The list of providers, with what each one does, is published on the website and updated when it changes.

## Deleting on time

Deletion is a scheduled job per category, run nightly, with a report on the data channel each Monday saying what was deleted. A job that fails twice in a row pages the on-call engineer.
