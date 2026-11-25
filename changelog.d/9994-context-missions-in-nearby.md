- Move the Space Missions roster into Inspect. When no item card is showing,
  it lists missions by launch time (upcoming launches soonest first, then the
  most recent), five a page with a range label that sets 5, 10 or 15, and a
  bar of launch providers. The Context search narrows it. A mission picked
  there or on the globe shows its card in the list's place, More details
  open. The header’s close button returns to the same page. Opening Missions keeps an active
  map follow, and Back to the followed item restores its card. Fly to
  and picking a mission on the globe end the follow and release aircraft or
  satellite tracking. Satellites already on keep their display settings,
  and Missions keeps the current satellite catalog. While Missions uses
  hidden Satellites for orbit data, an explicit Satellites ON (for example,
  through the `set_layer_visibility` voice tool) shows the fleet at once.
  Clicking the Satellites row in Data Layers sends OFF in this state and
  ends Missions. Closing a followed train's card stops the follow. Satellites
  and the launches layer keep no separate tile or Nearby group meanwhile.
  The list uses the kit's `ContextListCard`
  (manjunath22466, #9994).
