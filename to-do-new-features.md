# New Features To-Do List

## Features to Implement

1. Make the default sidebar view sort from newest to oldest
2. When adding new notes, add them to the top of the note list. The note list should always display the newest note first.
3. In the notes section header, add an "Export Notes" feature that will export the title of the video, the publish date, then all the notes in order of time from oldest to newest.
4. In the settings, add the ability to change the default number of words pre and post context.
5. Make the Get Context button the same size as Add note button.
6. Remove AI Find tips button and functionality.

~~Need to be able to share video and notes with other users.~~ ✅ Implemented

~~I want to be notified via email each time someone signs up.~~ ✅ Implemented

To monetize, what do recommend as as far as system limitations for a "free version" and different pricing tiers?

Can I also assign friends/testers with a paid version

---

## Future Monetization Plans

### Premium Features (to gate behind paid tier)
- **Video Sharing** - Currently free, should become premium-only
  - User-to-user sharing
  - Email sharing with invite links
  - "Shared with me" library access

### Implementation Notes
When implementing premium tiers:
1. Add `isPremium` or `subscriptionTier` field to user data
2. Check subscription status before allowing share creation
3. Consider grandfathering existing shares
4. Free tier could allow limited shares (e.g., 3 total) as a teaser
