# On-call and incident response

Someone from engineering is on call every hour of the year, because a hub that will not open its doors at 06:00 stops a courier's day. This runbook is what the on-call person does; the on-call rota and the escalation phone numbers are in the paging tool.

## The rotation

One primary and one secondary, a week each, Tuesday 10:00 to Tuesday 10:00. The primary gets every page; the secondary gets the page if the primary has not acknowledged within ten minutes. A week on call is paid as an allowance plus a day off in the following fortnight. Swap weeks in the paging tool, not by message, so the pages go to the right phone.

## What pages

Three things page: a hub offline for more than fifteen minutes, the booking API error rate above 2 % for five minutes, and a failed deployment. Everything else is a ticket for the morning. A page that was not one of these three is a bug in the alerting, and the fix is a change to the alert, made the same week.

## Severity

Sev 1: couriers cannot badge in at more than one hub, or data is being lost. Sev 2: one hub down, or a customer-facing feature broken for everyone. Sev 3: degraded, with a workaround. Sev 1 and 2 get an incident channel and a status page entry within fifteen minutes; Sev 3 is a ticket.

## The first fifteen minutes

Acknowledge the page. Open the incident channel with the hub id or the service name in its title. Say what you see, not what you think caused it. Check the deployment log: the most common cause is the last deployment, and rolling it back is always allowed without asking. If a hub is offline, the second most common cause is power at the site, and the field technician on duty can go and look.

## Hubs

A hub keeps working without the network: the doors open for badges it has seen in the last 30 days, and the events are stored on the hub and sent when it is back. So an offline hub is urgent but not a disaster, unless couriers new to that hub are waiting. The hub's own status page is reachable on the site network from the technician's laptop. Restart order: the modem, then the controller, then the chargers one by one. Never cut the power to the whole hub with a charger in session.

## Communication

The status page is updated every thirty minutes during a Sev 1 or 2, even if the update is "still looking". Customers with a hub down are told by their account owner, who is paged by the incident lead. Nobody speculates about causes in writing to a customer until the review is done.

## After

Every Sev 1 and 2 gets a written review within five working days: the timeline, what was done, what was learned, and the actions with owners and dates. Reviews are blameless and are read at the Thursday company meeting. A Sev 3 that happens three times becomes a Sev 2 for the purpose of the review.

## Handover

Tuesday at 10:00, fifteen minutes between the outgoing and incoming primaries: the open incidents, the hubs on watch, the deployments planned for the week. Written in the handover thread so the secondary can read it.
