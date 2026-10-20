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

## Put it online

Upload `index.html`, `letter.js` and the `art` folder. Do not upload `letter.jpg`, because that is the unlocked letter.

The quickest way is Netlify Drop (app.netlify.com/drop): make a folder with only those three things and drag it onto the page.

The pictures in `art` sit down both sides of the letter on a wide screen and move underneath it on a narrow one. They are not locked, so anyone who guesses the address of one can see it. Twelve are used: five chosen by me and seven found on Pinterest.
