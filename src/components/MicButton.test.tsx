import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MicButton from './MicButton';
import { useVoice } from '../voice/useVoice';
import type { UseVoiceResult } from '../voice/useVoice';

vi.mock('../voice/useVoice', () => ({ useVoice: vi.fn() }));

const useVoiceMock = vi.mocked(useVoice);

function voiceState(overrides: Partial<UseVoiceResult> = {}): UseVoiceResult {
  return {
    phase: 'idle',
    progress: 0,
    liveText: '',
    error: null,
    modelReady: false,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

function renderMic(overrides: Partial<UseVoiceResult> = {}) {
  const helpers = {
    appendText: vi.fn(),
    setText: vi.fn(),
    text: '',
  };
  const voice = voiceState(overrides);
  useVoiceMock.mockReturnValue(voice);
  render(<MicButton {...helpers} />);
  return { helpers, voice };
}

describe('MicButton', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers dictation when idle and shows the ready marker once the model is cached', () => {
    renderMic({ modelReady: true });
    expect(screen.getByRole('button', { name: 'Diktat starten' })).toBeTruthy();
    expect(screen.getByText('Modell bereit ✓')).toBeTruthy();
  });

  it('starts dictation from idle', () => {
    const { voice } = renderMic();
    fireEvent.click(screen.getByRole('button', { name: 'Diktat starten' }));
    expect(voice.start).toHaveBeenCalled();
  });

  it('shows byte progress with the WLAN hint on the first download', () => {
    renderMic({ phase: 'loading', progress: 0.42, modelReady: false });
    expect(screen.getByRole('button', { name: 'Modell wird geladen … 42 %' })).toBeTruthy();
    expect(screen.getByText('~77 MB – am besten über WLAN')).toBeTruthy();
  });

  it('aborts when tapped during loading', () => {
    const { voice } = renderMic({ phase: 'loading', progress: 0.1, modelReady: true });
    fireEvent.click(screen.getByRole('button', { name: /Modell wird geladen/ }));
    expect(voice.cancel).toHaveBeenCalled();
  });

  it('stops the recording when listening', () => {
    const { voice } = renderMic({ phase: 'listening', liveText: 'erste worte' });
    expect(screen.getByRole('button', { name: 'Aufnahme stoppen' })).toBeTruthy();
    expect(screen.getByText('erste worte')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aufnahme stoppen' }));
    expect(voice.stop).toHaveBeenCalled();
  });

  it('shows the transcribing state and aborts on tap', () => {
    const { voice } = renderMic({ phase: 'transcribing', liveText: 'gesprochen' });
    expect(screen.getByRole('button', { name: 'Transkribiere …' })).toBeTruthy();
    expect(screen.getByText(/Finale Transkription läuft/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Transkribiere …' }));
    expect(voice.cancel).toHaveBeenCalled();
  });

  it('offers retry on error and shows the German message', () => {
    const { voice } = renderMic({ phase: 'error', error: 'Mikrofon kaputt' });
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
    expect(screen.getByText('Mikrofon kaputt')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(voice.start).toHaveBeenCalled();
  });

  it('mirrors new live words into the entry via appendText', () => {
    const helpers = { appendText: vi.fn(), setText: vi.fn(), text: 'vorhanden' };
    useVoiceMock.mockReturnValue(voiceState());
    const { rerender } = render(<MicButton {...helpers} />);
    useVoiceMock.mockReturnValue(voiceState({ phase: 'listening', liveText: 'erste worte' }));
    rerender(<MicButton {...helpers} />);
    expect(helpers.appendText).toHaveBeenCalledWith('erste worte');
  });

  it('appends only the delta when the live text grows', () => {
    const helpers = { appendText: vi.fn(), setText: vi.fn(), text: 'vorhanden erste worte' };
    useVoiceMock.mockReturnValue(voiceState());
    const { rerender } = render(<MicButton {...helpers} />);
    useVoiceMock.mockReturnValue(voiceState({ phase: 'listening', liveText: 'erste worte' }));
    rerender(<MicButton {...helpers} />);
    helpers.appendText.mockClear();
    useVoiceMock.mockReturnValue(voiceState({ phase: 'listening', liveText: 'erste worte heute' }));
    rerender(<MicButton {...helpers} />);
    expect(helpers.appendText).toHaveBeenCalledWith('heute');
  });

  it('swaps the appended live text for the cleaned final text', () => {
    const helpers = {
      appendText: vi.fn(),
      setText: vi.fn(),
      text: 'Notiz ähm erste worte',
    };
    useVoiceMock.mockReturnValue(voiceState());
    const { rerender } = render(<MicButton {...helpers} />);
    useVoiceMock.mockReturnValue(voiceState({ phase: 'listening', liveText: 'erste worte' }));
    rerender(<MicButton {...helpers} />);
    expect(helpers.appendText).toHaveBeenCalledWith('erste worte');

    // The hook calls onFinal with the raw full transcription.
    const onFinal = useVoiceMock.mock.calls.at(-1)![0]?.onFinal;
    useVoiceMock.mockReturnValue(voiceState({ phase: 'transcribing' }));
    rerender(<MicButton {...helpers} />);
    onFinal?.('erste worte ähm.');

    // The ähm in „Notiz ähm" is user text before the dictation — untouched.
    // Only the final transcription itself is cleaned.
    expect(helpers.setText).toHaveBeenCalledWith('Notiz ähm erste worte.');
    expect(helpers.appendText).not.toHaveBeenCalledWith('erste worte ähm.');
  });

  it('appends instead of replacing when the user edited the live text away', () => {
    const helpers = { appendText: vi.fn(), setText: vi.fn(), text: 'vom user bearbeitet' };
    useVoiceMock.mockReturnValue(voiceState());
    const { rerender } = render(<MicButton {...helpers} />);
    useVoiceMock.mockReturnValue(voiceState({ phase: 'listening', liveText: 'erste worte' }));
    rerender(<MicButton {...helpers} />);
    helpers.appendText.mockClear();
    helpers.text = 'vom user bearbeitet';
    const onFinal = useVoiceMock.mock.calls.at(-1)![0]?.onFinal;
    onFinal?.('erste worte');
    expect(helpers.appendText).toHaveBeenCalledWith('erste worte');
    expect(helpers.setText).not.toHaveBeenCalled();
  });

  it('leaves the final text uncleaned when the toggle is off', () => {
    const helpers = { appendText: vi.fn(), setText: vi.fn(), text: 'erste worte' };
    useVoiceMock.mockReturnValue(voiceState());
    const { rerender } = render(<MicButton {...helpers} />);
    useVoiceMock.mockReturnValue(voiceState({ phase: 'listening', liveText: 'erste worte' }));
    rerender(<MicButton {...helpers} />);

    fireEvent.click(screen.getByLabelText('Füllwörter entfernen'));
    expect(localStorage.getItem('voiceFillerCleanup')).toBe('off');

    const onFinal = useVoiceMock.mock.calls.at(-1)![0]?.onFinal;
    onFinal?.('erste worte ähm');
    expect(helpers.setText).toHaveBeenCalledWith('erste worte ähm');
  });

  it('cancels dictation when the entry text was cleared (e.g. submitted)', () => {
    const helpers = { appendText: vi.fn(), setText: vi.fn(), text: '' };
    useVoiceMock.mockReturnValue(voiceState());
    const { rerender } = render(<MicButton {...helpers} />);

    // Listening with an empty entry text: there is nothing to dictate into
    // (the entry was submitted or cleared), so the session must end instead
    // of dictating into the next entry.
    const listeningVoice = voiceState({ phase: 'listening', liveText: 'erste worte' });
    useVoiceMock.mockReturnValue(listeningVoice);
    rerender(<MicButton {...helpers} />);
    expect(helpers.appendText).toHaveBeenCalledWith('erste worte');
    expect(listeningVoice.cancel).toHaveBeenCalled();
  });

  it('exposes the status region as aria-live', () => {
    renderMic({ phase: 'listening', liveText: 'laufender text' });
    expect(screen.getByText('laufender text').getAttribute('aria-live')).toBe('polite');
  });
});
