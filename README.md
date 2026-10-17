# Love letter

A page that looks like the notebook paper of the letter. It asks for a password, then shows the photo of the letter. The page's ruled lines and margin line up with the ones in the photo, so the paper seems to carry on past the picture.

The photo is encrypted with the password, so nobody can see it by viewing the page source or opening the file directly. The password is case-sensitive. Spaces at the start and end are ignored.

## Change the photo or password

1. Replace `letter.jpg` with the new photo.
2. Run `node lock.mjs "the password"` in this folder. This rewrites `letter.js`.
3. Open `index.html` to check it.

If the new photo is framed differently, the line and margin positions in `layoutLetter()` in `index.html` need updating.

## Put it online

Upload `index.html`, `letter.js` and the `art` folder. Do not upload `letter.jpg`, because that is the unlocked letter.

The quickest way is Netlify Drop (app.netlify.com/drop): make a folder with only those three things and drag it onto the page.

The pictures in `art` sit down both sides of the letter on a wide screen and move underneath it on a narrow one. They are not locked, so anyone who guesses the address of one can see it. Twelve are used: five chosen by me and seven found on Pinterest.
