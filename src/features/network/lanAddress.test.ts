import { movedBaseUrl } from './lanAddress';

describe('movedBaseUrl', () => {
  it('follows the router to its new address', () => {
    expect(movedBaseUrl('http://192.168.1.1', '192.168.1.1', '192.168.8.1')).toEqual({
      confirmAt: 'http://192.168.8.1',
      updateProfile: true,
    });
    expect(movedBaseUrl('https://192.168.1.1:8443', '192.168.1.1', '10.0.0.1')).toEqual({
      confirmAt: 'https://10.0.0.1:8443',
      updateProfile: true,
    });
  });

  it('keeps a host name, confirming at the new address meanwhile', () => {
    expect(movedBaseUrl('https://router.lan', '192.168.1.1', '192.168.8.1')).toEqual({
      confirmAt: 'https://192.168.8.1',
      updateProfile: false,
    });
  });
});
