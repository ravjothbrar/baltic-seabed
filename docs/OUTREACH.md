# Outreach plan: Baltic Seabed Watch → Helsing

## 0. Before sending anything
- [ ] Site live on `baltic.ravjothbrar.com`, loads in < 3 s, looks right on a phone.
- [ ] **30-second screen recording.** Clarity-style intro, then a live ship on a cable, the alert, the honesty
      panel, and finally the glider slider going 0 → 200. No voiceover; captions only. This does most of the work.
- [ ] 48 h of AIS recorded, 30+ episodes hand-labelled, and `npm run eval` gives a real false-positive rate.
      Save this number for the follow-up.
- [ ] Footer says "Independent project · not affiliated with Helsing". No Helsing logo anywhere.
- [ ] Every incident row checked against its sources (they came from search summaries; open each link).

## 1. Who to send it to
Helsing is a large company now with a formal hiring pipeline, and `careers@` reaches nobody who can act on this.
Send it to **named people**, and don't guess anyone's title.

1. **Co-founders.** Torsten Reil, Gundbert Scherf and Niklas Köhler. Check which of them actually posted about the
   Lura launch (LinkedIn/X) and lead with that person.
2. **The Lura / maritime team.** Search LinkedIn for "Helsing" + "Lura", "maritime", "underwater", "acoustic". Look
   for people who posted about the May 2025 launch or the Portsmouth demo. 2–3 people at most.
3. **Partners named in the launch.** Ocean Infinity, QinetiQ, Blue Ocean Marine Tech Systems. Hold these for
   week 3; they're re-aim targets, not the first wave.

Send **one email to 2–3 people at once** (all in To:), and say so. Small teams compare notes, and separate pitches
landing at the same time read as scattershot.

## 2. The email (≈108 words)

**Subject:** Seven Baltic cable cases. AIS settled none of them.

> Hi Torsten,
>
> Hope you don't mind the subject line, I needed to get your attention.
> I'll keep this short, because time is precious.
> I'm Ravjoth — a high schooler in the UK with published AI research, currently School Captain at Haberdashers'.
>
> At the Lura launch you said one operator could task hundreds of gliders. So I built what that operator might watch:
> a live Baltic globe that flags ships loitering or dragging over cables, says why each flag is probably innocent,
> and shows where gliders would close the gaps AIS can't see.
>
> baltic.ravjothbrar.com · 30s video: [link]
>
> I can take this further with your maritime team. Free the next two weeks.
> Can't wait to work together.
> Best, Ravjoth — ravjothbrar.com

Checks before sending:
- The subject line has to be true. The incident log lists 7 cases, and in none of them did AIS evidence alone settle
  the outcome (dismissed, inconclusive, accident, or still open). Re-check this the day you send.
- "At the Lura launch you said…": the quote is from Helsing's press release. If the recipient isn't the person who
  said it, change it to "Helsing says…".
- Swap the name for whoever you're actually sending to.

**LinkedIn DM version (≤ 300 characters, for a connection note):**
> Built a live Baltic seabed-watch globe that flags ships loitering over cables, explains why each flag is probably
> innocent, and ends on where Lura-style gliders close the gaps. Public data only. 30s: [link]. Would love your take.

## 3. Timeline
| Day | Action |
|---|---|
| 0 (Tue/Wed morning UK) | Email to 2–3 named people. LinkedIn connection note to the same people. |
| 7 | **One** follow-up, with new information in it (below). End with "That's me done pinging you." |
| 7–10 | Meanwhile, send the same build to 2 adjacent companies (§5). |
| 10–14 | **Public post**, regardless of replies (§4). Don't tag Helsing after an unanswered email. |
| 14+ | Stop. Ship the next improvement. If it travels, it'll reach them sideways. |

**Follow-up (day 7):**
> Quick update on Baltic Seabed Watch. I recorded 48 h of Gulf of Finland traffic and hand-labelled 40 episodes. The
> loitering rule fired on N ships; N−k were waiting on berths or weather, so on its own it's close to noise. That's
> the case for listening below the surface rather than watching AIS. [link]
> That's me done pinging you. Best, Ravjoth

## 4. Public post (LinkedIn + X, native video, link in first comment)
> Since 2023, ships have been accused of dragging anchors across Baltic cables. Courts and investigators keep finding
> the same thing: AIS tracks alone can't prove it.
>
> So I built Baltic Seabed Watch. It's a live globe that fuses ship positions, sanctions lists and seabed
> infrastructure, flags anomalies, and is honest about how weak each signal is. The last layer shows where a few
> hundred autonomous gliders would close the gap.
>
> Built in a weekend with Claude Code, all public data. What I learned: [1 surprising eval finding].

Credit Helsing's Lura as the inspiration in the text. Don't @-tag them.

## 5. Re-aim the same build
Each needs only a new first paragraph:
- **Ocean Infinity, QinetiQ**: Lura partners, same pitch.
- **Fingrid, Elering, Cinia, Arelion**: the asset owners in the incident log.
- **NATO Baltic Sentry**: public affairs / innovation contacts.
- **Saab, Kraken Robotics, Anduril UK**: underwater autonomy.
- **OSINT community**: Bellingcat, gCaptain editors. They might write about it.

## Expectations
Most cold sends get no reply, and that isn't a verdict on the work. What you keep either way: a live, technical,
honest portfolio piece, a public post, and a build you can re-aim at ten companies. Six days of silence is normal.
Founders' inboxes are unusable.
