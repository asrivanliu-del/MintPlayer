import { expect, test } from '@playwright/test';

const viewports = [
  { width: 840, height: 780 },
  { width: 1000, height: 700 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 }
];

for (const viewport of viewports) {
  test(`keeps playback controls in view at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('main', { name: 'Player' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    const app = page.locator('.app');
    const playerBottom = page.locator('.player-bottom');
    await expect(playerBottom).toBeVisible();
    await page.waitForTimeout(250);

    const layout = await page.evaluate(() => {
      const appElement = document.querySelector<HTMLElement>('.app');
      const controls = document.querySelector<HTMLElement>('.player-bottom');
      if (!appElement || !controls) throw new Error('Player layout elements are missing');
      const controlsBounds = controls.getBoundingClientRect();
      return {
        appClientHeight: appElement.clientHeight,
        appScrollHeight: appElement.scrollHeight,
        controlsTop: controlsBounds.top,
        controlsBottom: controlsBounds.bottom,
        viewportHeight: window.innerHeight
      };
    });

    expect(layout.appScrollHeight).toBeLessThanOrEqual(layout.appClientHeight + 1);
    expect(layout.controlsTop).toBeGreaterThanOrEqual(0);
    expect(layout.controlsBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
    await expect(app).toBeVisible();
  });
}

test('shows active media library filters with the same mint background as Play', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Media library', exact: true }).click();

  const playButton = page.getByRole('button', { name: 'Play', exact: true });
  const musicButton = page.getByRole('button', { name: 'Music files' });
  const videoButton = page.getByRole('button', { name: 'Video files' });
  const playBackground = await playButton.evaluate(element => getComputedStyle(element).backgroundImage);

  await expect(musicButton).toHaveAttribute('aria-pressed', 'true');
  await expect(videoButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => musicButton.evaluate(element => getComputedStyle(element).backgroundImage))
    .toBe(playBackground);
  await expect.poll(() => videoButton.evaluate(element => getComputedStyle(element).backgroundImage))
    .toBe(playBackground);

  await musicButton.click();
  await expect(musicButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => musicButton.evaluate(element => getComputedStyle(element).backgroundImage))
    .not.toBe(playBackground);
});

test('matches player media role button size and selected state to media library toggles', async ({ page }) => {
  await page.goto('/');

  const playButton = page.getByRole('button', { name: 'Play', exact: true });
  const musicRoleButton = page.getByRole('button', { name: 'Play music' });
  const [playSize, musicRoleSize] = await Promise.all([
    playButton.evaluate(element => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    }),
    musicRoleButton.evaluate(element => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    })
  ]);
  expect(musicRoleSize).toEqual(playSize);

  await page.getByRole('button', { name: 'Media library', exact: true }).click();
  const musicFilter = page.getByRole('button', { name: 'Music files' });
  const musicBackground = async () => musicFilter.evaluate(element => getComputedStyle(element).backgroundImage);
  const roleBackground = async () => musicRoleButton.evaluate(element => getComputedStyle(element).backgroundImage);
  const activeMusicBackground = await musicBackground();

  await musicRoleButton.evaluate(element => {
    element.removeAttribute('disabled');
    element.setAttribute('data-available', 'true');
    element.setAttribute('aria-pressed', 'true');
  });
  await expect.poll(roleBackground).toBe(activeMusicBackground);

  await musicRoleButton.evaluate(element => element.setAttribute('aria-pressed', 'false'));
  await expect.poll(roleBackground).not.toBe(activeMusicBackground);
});

test('places volume controls before the MVKAO media role buttons', async ({ page }) => {
  await page.goto('/');

  const muteButton = page.getByRole('button', { name: 'Mute' });
  const musicRoleButton = page.getByRole('button', { name: 'Play music' });
  await expect(muteButton).toBeVisible();
  await expect(musicRoleButton).toBeVisible();

  const order = await page.evaluate(() => {
    const toolbar = document.querySelector('.player-toolbar');
    const volumeControls = toolbar?.querySelector<HTMLElement>('.audio-controls');
    const mediaRoleControls = toolbar?.querySelector<HTMLElement>('.player-media-role-actions');
    const mute = toolbar?.querySelector<HTMLElement>('[aria-label="Mute"]');
    const music = toolbar?.querySelector<HTMLElement>('[aria-label="Play music"]');
    if (!toolbar || !volumeControls || !mediaRoleControls || !mute || !music) {
      throw new Error('Playback toolbar controls are missing');
    }

    return {
      volumeOrder: getComputedStyle(volumeControls).order,
      mediaOrder: getComputedStyle(mediaRoleControls).order,
      muteX: mute.getBoundingClientRect().x,
      muteY: mute.getBoundingClientRect().y,
      musicX: music.getBoundingClientRect().x,
      musicY: music.getBoundingClientRect().y
    };
  });
  expect(Number(order.volumeOrder)).toBeLessThan(Number(order.mediaOrder));
  expect(
    order.muteY < order.musicY - 1 ||
    (Math.abs(order.muteY - order.musicY) <= 1 && order.muteX < order.musicX)
  ).toBe(true);
});

test('renders missing media letters in gray instead of inheriting white text', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mediaLibraryPath', 'C:\\source');
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        readdirRecursive: async () => ({
          ok: true,
          files: [
            'C:\\source\\music\\Singer\\Album\\Song.mp3',
            'C:\\source\\video\\Singer\\Album\\Song.mp4',
            'C:\\source\\karaoke\\Singer\\Album\\Song.ass',
            'C:\\source\\karaoke\\Singer\\Album\\Song_backingtrack.mp3',
            'C:\\source\\karaoke\\Singer\\Album\\Song_vocals.wav',
            'C:\\source\\music\\Singer\\Album\\Only.mp3'
          ]
        })
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Media library', exact: true }).click();

  const song = page.getByRole('option', { name: 'Song' });
  const availableMusic = song.getByLabel('Music available');
  const topAvailabilityRow = song.getByLabel('Music, video, and karaoke availability');
  const bottomAvailabilityRow = song.getByLabel('Accompaniment and vocals availability');
  const missingVideo = page.getByRole('option', { name: 'Only' }).getByLabel('Video missing');

  const mediaLibraryList = page.getByRole('listbox', { name: 'Media library files' });
  await expect(song.getByLabel('Song location')).toHaveText('Singer\\Album');
  await expect(mediaLibraryList).toHaveCSS('scrollbar-width', 'thin');
  await expect(mediaLibraryList).toHaveCSS('scrollbar-color', 'rgb(110, 170, 145) rgb(17, 26, 23)');
  await expect(availableMusic).toHaveCSS('color', 'rgb(155, 232, 205)');
  await expect(missingVideo).toHaveCSS('color', 'rgb(101, 117, 110)');
  await expect(topAvailabilityRow).toContainText('MVK');
  await expect(bottomAvailabilityRow).toContainText('AO');
  await expect(song.getByRole('button')).toHaveCount(0);
  await song.click();
  const addButton = page.getByRole('button', { name: 'Add 1 selected file to playlist' });
  await expect(addButton).toBeEnabled();
  const musicFilter = page.getByRole('button', { name: 'Music files' });
  const layout = await page.evaluate(({ topRow, bottomRow, add, filter }) => {
    const topBounds = document.querySelector(`[aria-label="${topRow}"]`)!.getBoundingClientRect();
    const bottomBounds = document.querySelector(`[aria-label="${bottomRow}"]`)!.getBoundingClientRect();
    const addBounds = document.querySelector(`[aria-label="${add}"]`)!.getBoundingClientRect();
    const filterBounds = document.querySelector(`[aria-label="${filter}"]`)!.getBoundingClientRect();
    return {
      topRowY: topBounds.y,
      bottomRowY: bottomBounds.y,
      addRight: addBounds.right,
      addTop: addBounds.top,
      filterRight: filterBounds.right,
      filterTop: filterBounds.top
    };
  }, {
    topRow: 'Music, video, and karaoke availability',
    bottomRow: 'Accompaniment and vocals availability',
    add: 'Add 1 selected file to playlist',
    filter: 'Music files'
  });
  expect(layout.bottomRowY).toBeGreaterThan(layout.topRowY);
  expect(layout.addTop).toBe(layout.filterTop);
  expect(layout.addRight).toBeGreaterThan(layout.filterRight);
});

test('runs Vocal Splitter from the tools workspace with a chosen recursive folder', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mediaLibraryPath', 'C:\\Media');
    const state = { folder: '', recursive: false, outputRoot: '', processed: [] as string[] };
    Object.defineProperty(window, '__vocalSplitterTestState', { configurable: true, value: state });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        chooseFolder: async () => ({ canceled: false, paths: ['C:\\selected-folder'] }),
        scanAudioFiles: async (folder: string, recursive: boolean) => {
          state.folder = folder;
          state.recursive = recursive;
          return {
            ok: true,
            files: [
              'C:\\Media\\Music\\first.mp3',
              'C:\\Media\\Music\\second.flac',
              'C:\\Media\\Video\\Singer\\Album\\karaoke.mp4'
            ]
          };
        },
        splitAudioStems: async (filePath: string, outputRoot: string) => {
          state.outputRoot = outputRoot;
          state.processed.push(filePath);
          const outputRelative = filePath.split(/[\\/]/).slice(-1)[0]?.replace(/\.[^.]+$/, '');
          const sourceKind = /[\\/]Video[\\/]/i.test(filePath) ? 'Video' : 'Music';
          return {
            ok: true,
            vocalsPath: `C:\\Media\\${sourceKind}_Vocals\\${outputRelative}.wav`,
            accompanimentPath: `C:\\Media\\${sourceKind}_Accompaniments\\${outputRelative}.wav`
          };
        }
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: 'Vocal Splitter' }).click();

  const folderInput = page.getByRole('textbox', { name: 'Folder path' });
  await page.getByRole('button', { name: 'Browse...' }).click();
  await expect(folderInput).toHaveValue('C:\\selected-folder');
  await folderInput.fill('C:\\Media');
  await page.getByRole('button', { name: 'Include subfolders (recursive)' }).click();
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Completed: 3 succeeded, 0 failed.');

  const state = await page.evaluate(() => {
    const testWindow = window as Window & {
      __vocalSplitterTestState?: {
        folder: string;
        recursive: boolean;
        outputRoot: string;
        processed: string[];
      };
    };
    if (!testWindow.__vocalSplitterTestState) throw new Error('Vocal Splitter test state is missing.');
    return testWindow.__vocalSplitterTestState;
  });
  expect(state).toEqual({
    folder: 'C:\\Media',
    recursive: true,
    outputRoot: 'C:\\Media',
    processed: [
      'C:\\Media\\Music\\first.mp3',
      'C:\\Media\\Music\\second.flac',
      'C:\\Media\\Video\\Singer\\Album\\karaoke.mp4'
    ]
  });
});
