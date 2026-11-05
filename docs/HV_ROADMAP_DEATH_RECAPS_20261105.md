# Death recaps — roadmap #12

Initial local service reads up to 20 combat deaths belonging to the victim's Steam account, from the last 30 days. A provisional five-minute disclosure delay limits immediate tactical use. Production delay and live behavior require privacy review and staging validation.

The reader returns recorded attacker display name, event time and victim species when available. Historical schemas without victim species remain supported. Attacker Steam IDs and live positions are excluded. Attacker species, growth, death location, dinosaur age and continuous survival remain unknown because the current combat contract lacks sufficient evidence. Those fields need trusted event-time telemetry and conservative life association before delivery is complete.

The service defaults off through DEATH_RECAP_ENABLED. Local tests cover delayed disclosure, victim isolation, old and recent events, absent tables, historical species schema and unknown values. Account APIs, UI, opt-in/retention policy alignment and richer evidence remain pending. Roadmap #12 is Building / Testing and historical votes remain stored while freeing active slots.

Account reads are now wired through /api/death-recaps. The website derives victim identity from the authenticated Steam session and sends it over the internal bearer-authenticated Legacy route. Player responses are private/no-store. An isolated two-server test proves guest/unlinked rejection, forged query actor isolation, disclosure delay, internal authentication and disabled rollout. The browser page and richer event fields remain pending.
