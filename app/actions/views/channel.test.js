// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import configureStore from 'redux-mock-store';
import thunk from 'redux-thunk';

import initialState from 'app/initial_state';
import {Client4} from 'mattermost-redux/client';
import {ChannelTypes, PostTypes} from 'mattermost-redux/action_types';
import testHelper from 'test/test_helper';

import {ViewTypes} from 'app/constants';
import * as ChannelActions from 'app/actions/views/channel';
const {
    handleSelectChannel,
    handleSelectChannelByName,
    loadPostsIfNecessaryWithRetry,
    loadUnreadChannelPosts,
} = ChannelActions;

import postReducer from 'mattermost-redux/reducers/entities/posts';

import * as PostSelectors from 'mattermost-redux/selectors/entities/posts';
import * as ChannelSelectors from 'mattermost-redux/selectors/entities/channels';

const MOCK_CHANNEL_MARK_AS_READ = 'MOCK_CHANNEL_MARK_AS_READ';
const MOCK_CHANNEL_MARK_AS_VIEWED = 'MOCK_CHANNEL_MARK_AS_VIEWED';

jest.mock('mattermost-redux/actions/channels', () => {
    const channelActions = require.requireActual('mattermost-redux/actions/channels');
    return {
        ...channelActions,
        markChannelAsRead: jest.fn().mockReturnValue({type: 'MOCK_CHANNEL_MARK_AS_READ'}),
        markChannelAsViewed: jest.fn().mockReturnValue({type: 'MOCK_CHANNEL_MARK_AS_VIEWED'}),
    };
});

jest.mock('mattermost-redux/selectors/entities/teams', () => {
    const teamSelectors = require.requireActual('mattermost-redux/selectors/entities/teams');
    return {
        ...teamSelectors,
        getTeamByName: jest.fn(() => ({name: 'current-team-name'})),
    };
});

const mockStore = configureStore([thunk]);

describe('Actions.Views.Channel', () => {
    let store;

    const MOCK_SELECT_CHANNEL_TYPE = 'MOCK_SELECT_CHANNEL_TYPE';
    const MOCK_RECEIVE_CHANNEL_TYPE = 'MOCK_RECEIVE_CHANNEL_TYPE';
    const MOCK_RECEIVED_POSTS = 'RECEIVED_POSTS';
    const MOCK_RECEIVED_POSTS_IN_CHANNEL = 'RECEIVED_POSTS_IN_CHANNEL';
    const MOCK_RECEIVED_POSTS_SINCE = 'MOCK_RECEIVED_POSTS_SINCE';

    const actions = require('mattermost-redux/actions/channels');
    actions.getChannelByNameAndTeamName = jest.fn((teamName) => {
        if (teamName) {
            return {
                type: MOCK_RECEIVE_CHANNEL_TYPE,
                data: 'received-channel-id',
            };
        }

        return {
            type: 'MOCK_ERROR',
            error: 'error',
        };
    });
    actions.selectChannel = jest.fn().mockReturnValue({
        type: MOCK_SELECT_CHANNEL_TYPE,
        data: 'selected-channel-id',
    });
    const postActions = require('./post');
    postActions.getPostsSince = jest.fn(() => {
        return {
            type: MOCK_RECEIVED_POSTS_SINCE,
            data: {
                order: [],
                posts: {},
            },
        };
    });

    postActions.getPosts = jest.fn((channelId) => {
        const order = [];
        const posts = {};

        for (let i = 0; i < 60; i++) {
            const p = testHelper.fakePost(channelId);
            order.push(p.id);
            posts[p.id] = p;
        }

        return {
            type: MOCK_RECEIVED_POSTS,
            data: {
                order,
                posts,
            },
        };
    });

    const postUtils = require('mattermost-redux/utils/post_utils');
    postUtils.getLastCreateAt = jest.fn((array) => {
        return array[0].create_at;
    });

    let nextPostState = {};
    const currentUserId = 'current-user-id';
    const currentChannelId = 'channel-id';
    const currentChannelName = 'channel-name';
    const currentTeamId = 'current-team-id';
    const currentTeamName = 'current-team-name';
    const storeObj = {
        ...initialState,
        entities: {
            ...initialState.entities,
            users: {
                currentUserId,
            },
            channels: {
                currentChannelId,
                manuallyUnread: {},
                channels: {
                    'channel-id': {id: 'channel-id', display_name: 'Test Channel'},
                    'channel-id-2': {id: 'channel-id-2', display_name: 'Test Channel'},
                },
                myMembers: {
                    'channel-id': {channel_id: 'channel-id', user_id: currentUserId, mention_count: 0, msg_count: 0},
                    'channel-id-2': {channel_id: 'channel-id-2', user_id: currentUserId, mention_count: 0, msg_count: 0},
                },
            },
            teams: {
                currentTeamId,
                teams: {
                    [currentTeamId]: {
                        id: currentTeamId,
                        name: currentTeamName,
                    },
                },
            },
        },
    };

    const channelSelectors = require('mattermost-redux/selectors/entities/channels');
    channelSelectors.getChannel = jest.fn((state, channelId) => ({data: channelId}));
    channelSelectors.getCurrentChannelId = jest.fn(() => currentChannelId);
    channelSelectors.getMyChannelMember = jest.fn(() => ({data: {member: {}}}));

    const appChannelSelectors = require('app/selectors/channel');
    appChannelSelectors.getChannelReachable = jest.fn(() => true);

    test('handleSelectChannelByName success', async () => {
        store = mockStore(storeObj);

        await store.dispatch(handleSelectChannelByName(currentChannelName, currentTeamName));

        const storeActions = store.getActions();
        const receivedChannel = storeActions.some((action) => action.type === MOCK_RECEIVE_CHANNEL_TYPE);
        expect(receivedChannel).toBe(true);

        const selectedChannel = storeActions.some(({type}) => type === MOCK_RECEIVE_CHANNEL_TYPE);
        expect(selectedChannel).toBe(true);
    });

    test('handleSelectChannelByName failure from null currentTeamName', async () => {
        const failStoreObj = {...storeObj};
        failStoreObj.entities.teams.currentTeamId = 'not-in-current-teams';
        store = mockStore(failStoreObj);

        await store.dispatch(handleSelectChannelByName(currentChannelName, null));

        const storeActions = store.getActions();
        const receivedChannel = storeActions.some((action) => action.type === MOCK_RECEIVE_CHANNEL_TYPE);
        expect(receivedChannel).toBe(false);

        const storeBatchActions = storeActions.some(({type}) => type === 'BATCHING_REDUCER.BATCH');
        expect(storeBatchActions).toBe(false);
    });

    test('handleSelectChannelByName failure from no permission to channel', async () => {
        store = mockStore({...storeObj});
        actions.getChannelByNameAndTeamName = jest.fn(() => {
            return {
                type: 'MOCK_ERROR',
                error: {
                    message: "Can't get to channel.",
                },
            };
        });

        await store.dispatch(handleSelectChannelByName(currentChannelName, currentTeamName));

        const storeActions = store.getActions();
        const receivedChannel = storeActions.some((action) => action.type === MOCK_RECEIVE_CHANNEL_TYPE);
        expect(receivedChannel).toBe(false);
    });

    test('handleSelectChannelByName failure from unreachable channel', async () => {
        appChannelSelectors.getChannelReachable = jest.fn(() => false);

        store = mockStore(storeObj);

        await store.dispatch(handleSelectChannelByName(currentChannelName, currentTeamName));

        const storeActions = store.getActions();
        const receivedChannel = storeActions.some((action) => action.type === MOCK_RECEIVE_CHANNEL_TYPE);
        expect(receivedChannel).toBe(false);
    });

    test('loadPostsIfNecessaryWithRetry for the first time', async () => {
        store = mockStore(storeObj);

        await store.dispatch(loadPostsIfNecessaryWithRetry(currentChannelId));
        expect(postActions.getPosts).toBeCalled();

        const storeActions = store.getActions();
        const storeBatchActions = storeActions.filter(({type}) => type === 'BATCH_LOAD_POSTS_IN_CHANNEL');
        const receivedPosts = storeActions.find(({type}) => type === MOCK_RECEIVED_POSTS);
        const receivedPostsAtAction = storeBatchActions[0].payload.some((action) => action.type === ViewTypes.RECEIVED_POSTS_FOR_CHANNEL_AT_TIME);

        nextPostState = postReducer(store.getState().entities.posts, receivedPosts);
        nextPostState = postReducer(nextPostState, {
            type: MOCK_RECEIVED_POSTS_IN_CHANNEL,
            channelId: currentChannelId,
            data: receivedPosts.data,
            recent: true,
        });

        expect(receivedPostsAtAction).toBe(true);
    });

    test('loadPostsIfNecessaryWithRetry get posts since', async () => {
        store = mockStore({
            ...storeObj,
            entities: {
                ...storeObj.entities,
                posts: nextPostState,
            },
            views: {
                ...storeObj.views,
                channel: {
                    ...storeObj.views.channel,
                    lastGetPosts: {
                        [currentChannelId]: Date.now(),
                    },
                },
            },
        });

        await store.dispatch(loadPostsIfNecessaryWithRetry(currentChannelId));
        const storeActions = store.getActions();
        const receivedPostsSince = storeActions.find(({type}) => type === MOCK_RECEIVED_POSTS_SINCE);

        expect(postUtils.getLastCreateAt).toBeCalled();
        expect(postActions.getPostsSince).toHaveBeenCalledWith(currentChannelId, Object.values(store.getState().entities.posts.posts)[0].create_at);
        expect(receivedPostsSince).not.toBe(null);
    });

    test('loadPostsIfNecessaryWithRetry get posts since the websocket reconnected', async () => {
        const time = Date.now();
        store = mockStore({
            ...storeObj,
            entities: {
                ...storeObj.entities,
                posts: nextPostState,
            },
            views: {
                ...storeObj.views,
                channel: {
                    ...storeObj.views.channel,
                    lastGetPosts: {
                        [currentChannelId]: time,
                    },
                },
            },
            websocket: {
                lastConnectAt: time + (1 * 60 * 1000),
            },
        });

        await store.dispatch(loadPostsIfNecessaryWithRetry(currentChannelId));
        const storeActions = store.getActions();
        const receivedPostsSince = storeActions.find(({type}) => type === MOCK_RECEIVED_POSTS_SINCE);

        expect(postUtils.getLastCreateAt).not.toBeCalled();
        expect(postActions.getPostsSince).toHaveBeenCalledWith(currentChannelId, store.getState().views.channel.lastGetPosts[currentChannelId]);
        expect(receivedPostsSince).not.toBe(null);
    });

    const handleSelectChannelCases = [
        [currentChannelId],
        [`${currentChannelId}-2`],
        [`not-${currentChannelId}`],
        [`not-${currentChannelId}-2`],
    ];
    test.each(handleSelectChannelCases)('handleSelectChannel dispatches selectChannelWithMember', async (channelId) => {
        const testObj = {...storeObj};
        testObj.entities.teams.currentTeamId = currentTeamId;
        store = mockStore(testObj);

        await store.dispatch(handleSelectChannel(channelId));
        const storeActions = store.getActions();
        const storeBatchActions = storeActions.find(({type}) => type === 'BATCH_SWITCH_CHANNEL');
        const selectChannelWithMember = storeBatchActions?.payload.find(({type}) => type === ChannelTypes.SELECT_CHANNEL);
        const viewedAction = storeActions.find(({type}) => type === MOCK_CHANNEL_MARK_AS_VIEWED);
        const readAction = storeActions.find(({type}) => type === MOCK_CHANNEL_MARK_AS_READ);

        const expectedSelectChannelWithMember = {
            type: ChannelTypes.SELECT_CHANNEL,
            data: channelId,
            extra: {
                channel: {
                    id: channelId,
                    display_name: 'Test Channel',
                },
                member: {
                    channel_id: channelId,
                    user_id: currentUserId,
                    mention_count: 0,
                    msg_count: 0,
                },
                teamId: currentTeamId,
            },
        };
        if (channelId.includes('not') || channelId === currentChannelId) {
            expect(selectChannelWithMember).toBe(undefined);
        } else {
            expect(selectChannelWithMember).toStrictEqual(expectedSelectChannelWithMember);
        }
        expect(viewedAction).not.toBe(null);
        expect(readAction).not.toBe(null);
    });

    test('loadUnreadChannelPosts does not dispatch actions if no unread channels', async () => {
        ChannelSelectors.getUnreadChannelIds = jest.fn().mockReturnValueOnce([]);
        store = mockStore(storeObj);
        await store.dispatch(loadUnreadChannelPosts());
        const storeActions = store.getActions();
        expect(storeActions).toStrictEqual([]);
    });

    test('loadUnreadChannelPosts dispatches actions for unread channels with no postIds in channel', async () => {
        const unreadChannelIds = ['channel-1', 'channel-2', 'channel-3'];
        ChannelSelectors.getUnreadChannelIds = jest.fn().mockReturnValueOnce(unreadChannelIds);
        Client4.getPosts = jest.fn().mockResolvedValue({posts: ['post-1', 'post-2']});

        store = mockStore(storeObj);
        await store.dispatch(loadUnreadChannelPosts());

        const actionTypes = store.getActions()[0].payload.map((action) => action.type);

        // Actions dispatched:
        // RECEIVED_POSTS_IN_CHANNEL and RECEIVED_POSTS_FOR_CHANNEL_AT_TIME for each channel.
        // RECEIVED_POSTS once, with all channel posts combined.
        expect(actionTypes.length).toBe((2 * unreadChannelIds.length) + 1);

        const receivedPostsInChannelActions = actionTypes.filter((type) => type === PostTypes.RECEIVED_POSTS_IN_CHANNEL);
        expect(receivedPostsInChannelActions.length).toBe(unreadChannelIds.length);

        const receivedPostsForChannelAtTimeActions = actionTypes.filter((type) => type === ViewTypes.RECEIVED_POSTS_FOR_CHANNEL_AT_TIME);
        expect(receivedPostsForChannelAtTimeActions.length).toBe(unreadChannelIds.length);

        const receivedPosts = actionTypes.filter((type) => type === 'RECEIVED_POSTS');
        expect(receivedPosts.length).toBe(1);
    });

    test('loadUnreadChannelPosts dispatches actions for unread channels with postIds in channel', async () => {
        const unreadChannelIds = ['channel-1', 'channel-2', 'channel-3'];
        ChannelSelectors.getUnreadChannelIds = jest.fn().mockReturnValueOnce(unreadChannelIds);
        PostSelectors.getPostIdsInChannel = jest.fn().mockReturnValue(['post-id-in-channel']);
        Client4.getPostsSince = jest.fn().mockResolvedValue({posts: ['post-1', 'post-2']});

        const lastGetPosts = {};
        unreadChannelIds.forEach((id) => {
            lastGetPosts[id] = Date.now();
        });
        const lastConnectAt = Date.now() + 1000;
        store = mockStore({
            ...storeObj,
            views: {
                channel: {
                    lastGetPosts,
                },
            },
            websocket: {
                lastConnectAt,
            },
        });
        await store.dispatch(loadUnreadChannelPosts());

        const actionTypes = store.getActions()[0].payload.map((action) => action.type);

        // Actions dispatched:
        // RECEIVED_POSTS_SINCE and RECEIVED_POSTS_FOR_CHANNEL_AT_TIME for each channel.
        // RECEIVED_POSTS once, with all channel posts combined.
        expect(actionTypes.length).toBe((2 * unreadChannelIds.length) + 1);

        const receivedPostsInChannelActions = actionTypes.filter((type) => type === PostTypes.RECEIVED_POSTS_SINCE);
        expect(receivedPostsInChannelActions.length).toBe(unreadChannelIds.length);

        const receivedPostsForChannelAtTimeActions = actionTypes.filter((type) => type === ViewTypes.RECEIVED_POSTS_FOR_CHANNEL_AT_TIME);
        expect(receivedPostsForChannelAtTimeActions.length).toBe(unreadChannelIds.length);

        const receivedPosts = actionTypes.filter((type) => type === PostTypes.RECEIVED_POSTS);
        expect(receivedPosts.length).toBe(1);
    });
});
