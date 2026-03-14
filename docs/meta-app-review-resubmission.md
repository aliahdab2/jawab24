
## 1. pages_show_list

### Submission Text

Jawab24 uses the pages_show_list permission during Facebook Login to identify and display the Facebook Pages a user manages.

When a user logs in with Facebook, Meta asks the user to grant permission to "Show a list of the Pages you manage." After the user grants this permission, Jawab24 retrieves the list of Facebook Pages the user manages and displays them in the My Pages section of the Jawab24 dashboard.

This allows the user to:
- View the Facebook Pages associated with their account
- See which Pages are currently connected to Jawab24
- Connect or reconnect a Page through Meta authorization
- Manage automation settings for connected Pages, such as enabling or disabling automatic replies

---

## 2. pages_read_engagement

### Submission Text

Jawab24 uses the pages_read_engagement permission to read comments and engagement activity on connected Facebook Pages.

After a Page is connected, Jawab24 can receive comments posted by customers on Page posts. When a new comment is created, Jawab24 retrieves the comment and displays it in the Comments section of the dashboard.

This allows Page owners to monitor customer interactions and automatically respond to comments using AI-generated or template-based replies.

### Screencast Description (for submission)

The screencast demonstrates:
1. The user logging in with Facebook
2. Meta requesting the pages_read_engagement permission
3. The user granting permission
4. A customer posting a comment on a Facebook Page post
5. Jawab24 receiving and displaying the comment in the dashboard
6. Jawab24 generating an automatic reply

### Screencast Scenes

| Scene | Action | Caption |
|-------|--------|---------|
| 1 | Show `jawab24.com/en/login` (logged out) | *"User visits Jawab24 login page"* |
| 2 | Click "Login with Facebook" | *"User clicks Login with Facebook"* |
| 3 | Enter credentials on Facebook | *"User authenticates with Facebook"* |
| 4 | Permission dialog — zoom in on "Read content posted on the Page" | *"Facebook requests the pages_read_engagement permission"* (pause 2 seconds) |
| 5 | Click Continue/Save | *"User grants permission"* |
| 6 | Show Page connected in Jawab24 | *"The Facebook Page is connected to Jawab24"* |
| 7 | Switch to Facebook — post a comment from another account | *"A customer comments on a post on the Facebook Page"* |
| 8 | Switch to Jawab24 → `/en/comments` — comment appears | *"Jawab24 receives the new comment and displays it in the dashboard"* |
| 9 | Show reply generation | *"Jawab24 reads the comment and generates an automatic reply"* |

### Key: You MUST show the comment being created on Facebook, then appearing in Jawab24. Without this, reviewers reject.

### Status: [ ] Video recorded  [ ] Captions added  [ ] Ready to submit
