import React from 'react';

interface MockComponentProps {
    title?: string;
}

const MockComponent: React.FC<MockComponentProps> = ({ title = 'Mock Component' }) => {
    return (
        <div className="p-4 border rounded">
            <h2 className="text-xl font-bold">{title}</h2>
            <p>This is a mock component.</p>
        </div>
    );
};

export default MockComponent;