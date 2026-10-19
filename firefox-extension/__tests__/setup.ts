// Jest setup file for browser API mocking

// Mock the browser API completely
const mockBrowser = {
  tabs: {
    create: jest.fn(),
    remove: jest.fn(),
    query: jest.fn(),
    get: jest.fn(),
    executeScript: jest.fn(),
    move: jest.fn(),
    update: jest.fn(),
    group: jest.fn(),
    captureVisibleTab: jest.fn(),
    goBack: jest.fn(),
    sendMessage: jest.fn(),
    goForward: jest.fn(),
    reload: jest.fn(),
    onUpdated: { addListener: jest.fn() },
    onRemoved: { addListener: jest.fn() },
  },
  browserAction: {
    setBadgeText: jest.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: jest.fn().mockResolvedValue(undefined),
    onClicked: { addListener: jest.fn() },
  },
  tabGroups: {
    update: jest.fn(),
    query: jest.fn().mockResolvedValue([]),
  },
  history: {
    search: jest.fn(),
  },
  find: {
    find: jest.fn(),
    highlightResults: jest.fn(),
  },
  storage: {
    local: {
        get: jest.fn(),
        set: jest.fn(),
    },
    session: {
        get: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue(undefined),
    },
    onChanged: { addListener: jest.fn() },
  },
  webRequest: {
    onCompleted: { addListener: jest.fn() },
    onErrorOccurred: { addListener: jest.fn() },
  },
  permissions: {
    contains: jest.fn(),
  },
  runtime: {
    getURL: jest.fn(),
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() },
    id: "claude-no-firefox@g-lacerda",
  },
};

// Override the global browser object
Object.defineProperty(global, 'browser', {
  value: mockBrowser,
  writable: true,
  configurable: true,
});

// Export for use in tests
export { mockBrowser };
