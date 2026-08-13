describe('SupportWebRTC PeerJS lifecycle', () => {
  beforeEach(() => {
    jest.resetModules();

    const stream = {
      getAudioTracks: () => [{ enabled: true }],
      getVideoTracks: () => [{ enabled: true }],
      getTracks: () => [],
    };

    const handlers = {};
    const elements = {};

    function getElement(id) {
      if (!elements[id]) {
        elements[id] = {
          hidden: false,
          textContent: '',
          srcObject: null,
          classList: { remove: jest.fn(), add: jest.fn() },
          addEventListener: jest.fn(),
          querySelector: jest.fn(() => ({ textContent: '' })),
        };
      }
      return elements[id];
    }

    global.window = {
      appState: {
        selectedTicketId: 1,
        socket: {
          emit: jest.fn((_event, _payload, ack) => {
            if (typeof ack === 'function') ack({ appelId: 99, statut: 'initie' });
          }),
        },
      },
      location: { hostname: 'localhost', protocol: 'http:' },
      SupportWebRTC: null,
    };

    global.document = {
      addEventListener: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      getElementById: jest.fn((id) => getElement(id)),
    };

    global.navigator = {
      mediaDevices: {
        getUserMedia: jest.fn(async () => stream),
      },
    };

    class MockPeer {
      constructor() {
        this.id = 'peer-123';
        this.disconnected = false;
        this.readyState = 'open';
        this._listeners = {};
        this.disconnect = jest.fn(() => {
          this.disconnected = true;
          if (this._listeners.disconnected) this._listeners.disconnected();
        });
        this.destroy = jest.fn(() => {
          this.disconnected = true;
          this.readyState = 'closed';
          if (this._listeners.close) this._listeners.close();
        });
        this.call = jest.fn(() => ({
          on: jest.fn(),
          close: jest.fn(),
          peerConnection: { getSenders: () => [] },
        }));
      }
      on(eventName, callback) {
        this._listeners[eventName] = callback;
        return this;
      }
      off(eventName, callback) {
        if (this._listeners[eventName] === callback) delete this._listeners[eventName];
        return this;
      }
    }

    global.Peer = MockPeer;

    require('../public/js/webrtc.js');
    handlers.DOMContentLoaded();
    window.SupportWebRTC = global.window.SupportWebRTC;
  });

  test('cancelCall should reset the peer so a new call can be initiated', async () => {
    const initialPeer = window.SupportWebRTC.startCall;
    expect(typeof initialPeer).toBe('function');

    await window.SupportWebRTC.cancelCall();
    await expect(window.SupportWebRTC.startCall('audio')).resolves.toBeUndefined();
    expect(window.appState.socket.emit).toHaveBeenCalledWith(
      'appel:initier',
      expect.objectContaining({ ticketId: 1, type: 'audio' }),
      expect.any(Function)
    );
  });
});
