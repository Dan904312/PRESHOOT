import React from 'react';
import { useState } from 'react';

const ProfilePage = () => {
    const [profile, setProfile] = useState({
        name: '',
        email: '',
        socialAccounts: [],
        videos: []
    });

    const handleProfileChange = (e) => {
        const { name, value } = e.target;
        setProfile({ ...profile, [name]: value });
    };

    const handleSocialAccountLinking = (account) => {
        setProfile({ ...profile, socialAccounts: [...profile.socialAccounts, account] });
    };

    const handleVideoImport = (video) => {
        setProfile({ ...profile, videos: [...profile.videos, video] });
    };

    return (
        <div>
            <h1>Profile Page</h1>
            <form>
                <div>
                    <label>Name:</label>
                    <input type="text" name="name" value={profile.name} onChange={handleProfileChange} />
                </div>
                <div>
                    <label>Email:</label>
                    <input type="email" name="email" value={profile.email} onChange={handleProfileChange} />
                </div>
                <div>
                    <h2>Social Account Linking</h2>
                    <button type="button" onClick={() => handleSocialAccountLinking('Facebook')}>Link Facebook</button>
                    <button type="button" onClick={() => handleSocialAccountLinking('Twitter')}>Link Twitter</button>
                </div>
                <div>
                    <h2>Video Import</h2>
                    <button type="button" onClick={() => handleVideoImport('video-url')}>Import Video</button>
                </div>
                <button type="submit">Save Profile</button>
            </form>
            <div>
                <h3>Linked Social Accounts:</h3>
                <ul>
                    {profile.socialAccounts.map((account, index) => (
                        <li key={index}>{account}</li>
                    ))}
                </ul>
                <h3>Imported Videos:</h3>
                <ul>
                    {profile.videos.map((video, index) => (
                        <li key={index}>{video}</li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

export default ProfilePage;