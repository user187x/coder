# The image store's baked pictures

Every picture chooser of the platform - the announcement's image (its Upload image arrow), the dashboard's and the
sign-in page's backgrounds, avatars, the logo, template icons - offers the same image store: these pictures, the ones
baked into the dashboard (`site/static/pictures/` in the fork), the gallery's, and every picture uploaded for the
announcement.

- `pictures/`: the pictures, as they are (animated GIFs; PNG, JPEG, WebP and AVIF work too). Shipped in the platform
  service's image (`development/tools/build-ui-image.sh`) at `/image-store/pictures`, a layer of its own under the
  code's, so a later build of new code does not ship them again; served publicly at
  `/__coder-ui/image-store/<name>`.
- `thumbs/<name>.webp`: each picture's small animated preview (192 px wide, its first seconds), which the choosers
  show instead of the picture (some are tens of MB). Made by `development/tools/image-store-thumbs.sh` - run it after
  adding a picture; the image build refuses a picture without one.

A background chosen from here keeps the picture's address, not a copy; an avatar, a logo or an icon is resized from
it as from an upload.
