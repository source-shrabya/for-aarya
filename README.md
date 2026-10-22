# Love letter

A page that looks like the notebook paper of the letter. It asks for a password, then shows the photo of the letter. The page's ruled lines and margin line up with the ones in the photo, so the paper seems to carry on past the picture.

The photo is encrypted with the password, so nobody can see it by viewing the page source or opening the file directly. The password is case-sensitive. Spaces at the start and end are ignored.

## Change the photo or password

1. Replace `letter.jpg` with the new photo.
2. Run `node lock.mjs "Aarya's password" "my password"` in this folder. This rewrites `letter.js` so either password opens the letter.
3. Open `index.html` to check it.

If the new photo is framed differently, the line and margin positions in `layoutLetter()` in `index.html` need updating.

## The decorating bot

After the letter opens, a "सजाउ" button opens a chat. Anyone with the password can ask it to change the page: paper colour and pattern, pictures and how they are framed, handwritten notes, emoji stickers, and things falling down the screen. Changes are saved for everyone. Undo goes back one change, up to 20, and "Back to original" restores the page as I made it.

The bot cannot touch the letter photo or the password. Claude only picks values from a fixed list of settings (`netlify/lib/settings.mjs`), and the server checks every value before saving it.

The page stays on GitHub Pages. The bot's server is one Netlify function (`netlify/functions/customize.mjs`) that checks the password, asks Claude (claude-opus-5-5), and saves the settings in Netlify Blobs. It needs three environment variables on Netlify: `ANTHROPIC_API_KEY`, `SITE_PASSWORD` (Aarya's password) and `SHRABYA_PASSWORD` (mine). If either password changes, run `lock.mjs` with both and update the Netlify variable too.

If the server is down or not set up, the page works as before without the button.

## Our letters

The letters we write each other sit under my first letter, oldest first, each on its own sheet of lined paper. A "नयाँ चिठी लेख" button under the last one opens the writing box. Either of us can write one: type it, add a photo of a letter written on paper, or both. The server knows who wrote it from the password, so each letter is signed without asking. Only the one who wrote a letter can remove it.

Letters and their photos are kept in Netlify Blobs, next to the bot's settings, and every request needs one of the two passwords. Photos are shrunk to 2000 pixels on the long side before they are sent.

## Our movies

The "फिल्महरू" button at the bottom left of the letter page goes to `movies.html`, a page of its own with two lists: movies we have watched and movies we want to watch. Movies we want to see are cinema tickets. When we tick one as watched, the ticket tears and the stub moves to the watched side with the date stamped on it. Either of us can add or remove a movie. The list started with the movies we had already written down.

The search box at the top looks movies up as you type and shows their posters. The server asks IMDb's search box for this (`/api/movies/search`), which needs no key but is not an official API. If it ever stops answering, a movie can still be added by its name.

## Our pictures

The "तस्बिरहरू" button above "फिल्महरू" goes to `pictures.html`, our picture archive. Pictures hang on the paper as taped polaroids, grouped by the month they were taken, newest first. Clicking one opens it big, with arrows (or the arrow keys) to the next one.

To add pictures, tap the empty polaroid at the top or drop files on it. Several can go at once. Each one waits in a tray with a box for a caption and the day it was taken, which the page reads from the photo's camera data when it has any and from the file's date when it does not. "टाँस" sends them one at a time. The page shrinks each picture to 2000 pixels on the long side, and also sends a 600 pixel copy for the wall so the page loads quickly. Only the one who added a picture can remove it.

Nobody else can see the lists, the letters or the photos: every request to the server needs one of our two passwords, and the server answers a wrong one with "wrong password". The page files on GitHub hold no letters or movies.

The password is kept in the browser tab after the letter opens, so going to the movies page and back does not ask for it again. Closing the tab forgets it.

## Put it online

Upload `index.html`, `movies.html`, `pictures.html`, `letter.js` and the `art` folder. Do not upload `letter.jpg`, because that is the unlocked letter.

The quickest way is Netlify Drop (app.netlify.com/drop): make a folder with only those things and drag it onto the page.

The pictures in `art` sit down both sides of the letter on a wide screen and move underneath it on a narrow one. They are not locked, so anyone who guesses the address of one can see it. Twelve are used: five chosen by me and seven found on Pinterest.
