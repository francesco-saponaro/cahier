# Deploying the platform

The platform is three services (the booking API, the fleet service that talks to hubs, and the web app) and one database. Each is deployed on its own, from the main branch, by the pipeline. This page is how a change gets to production and how it comes back if it should not have.

## The path of a change

A change is a pull request with tests, reviewed by one person who did not write it, merged into main by the author once the checks are green. Merging deploys to staging within ten minutes. Production is a manual step in the pipeline, pressed by the author during deployment hours: Monday to Thursday, 10:00 to 16:00 Paris time. There are no production deployments on Fridays, on the day before a public holiday, or during a Sev 1 or 2 incident.

## Staging

Staging runs against a copy of production data from the night before, with the personal fields replaced by generated values. Two real hubs in the Lyon depot are connected to staging, so a fleet service change is tested against hardware before it meets the street. Staging is reset every night at 03:00.

## Database changes

A migration ships in its own pull request before the code that uses it, and must be backwards compatible with the running version: add a column, never rename one in the same release; make it nullable first, fill it, then add the constraint in a later migration. A migration that locks a big table runs at 05:00 through the maintenance job, not from the pipeline. Every migration has a tested down migration.

## Rolling out

The booking API and the web app roll out one instance at a time behind the load balancer, with the health check holding traffic until the new instance answers. The fleet service is different: hubs keep a long connection to it, so a deployment moves hubs over in batches of 10 % with a five-minute wait between batches, and the pipeline stops if the hub reconnection rate drops.

## Feature flags

Anything a customer can see goes behind a flag, off by default, turned on per customer from the admin page. A flag that has been on for everyone for a month is removed, with its code, in the next release. Flags are not a substitute for tests.

## Rolling back

Rolling back is a button in the pipeline that redeploys the previous version, and anyone on the on-call rotation can press it without asking. It takes about four minutes for the API and the web app, and about twenty for the fleet service because of the batches. A rolled-back change is not redeployed until the review has said why it failed.

## Hub firmware

Firmware is not deployed by this pipeline. A firmware release is signed by two people on the firmware team, pushed to the two depot hubs first, then to a canary group of 5 % of the fleet for a week, then to everyone in batches by city. A hub that fails to boot the new firmware falls back to the previous one on its own.

## The checklist before pressing production

The staging deployment is green. The change has a flag if a customer can see it. The migration, if any, is already in production. It is a deployment hour. The on-call primary knows. You will be at your laptop for the next hour.
